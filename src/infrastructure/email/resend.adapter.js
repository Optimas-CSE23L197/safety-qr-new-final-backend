import { Resend } from 'resend';
import React from 'react'; // ✅ ADD THIS
import { EmailProvider } from './email.provider.js';
import { logger } from '#config/logger.js';
import { render } from '@react-email/components';

export class ResendAdapter extends EmailProvider {
  constructor(config = {}) {
    super();
    this.client = new Resend(config.API_KEY || process.env.RESEND_API_KEY);
    this.defaultFrom =
      config.FROM_EMAIL || process.env.RESEND_FROM_EMAIL || 'RESQID <noreply@mail.getresqid.in>';
  }

  async send(options) {
    const { to, subject, html, text, from = this.defaultFrom, replyTo } = options;
    const recipients = Array.isArray(to) ? to : [to];

    try {
      const response = await this.client.emails.send({
        from,
        to: recipients,
        subject,
        html,
        text,
        reply_to: replyTo,
      });

      logger.info({ to: recipients, id: response.id }, '[Email] Sent via Resend');
      return { success: true, id: response.id };
    } catch (err) {
      logger.error({ to: recipients, error: err.message }, '[Email] Resend send failed');
      return { success: false, error: err.message };
    }
  }

  async sendReactTemplate(Component, props = {}, { to, subject, from, replyTo } = {}) {
    try {
      const element = React.createElement(Component, props);
      const html = await render(element);
      const text = await render(element, { plainText: true });
      return this.send({ to, subject, html, text, from, replyTo });
    } catch (err) {
      logger.error({ error: err.message, to }, '[Email] Resend template render/send failed');
      return { success: false, error: err.message };
    }
  }

  async sendBulk(emails) {
    const results = await Promise.allSettled(emails.map(email => this.send(email)));
    return results.map((result, index) =>
      result.status === 'fulfilled'
        ? result.value
        : { success: false, error: result.reason?.message, to: emails[index]?.to }
    );
  }
}

export default ResendAdapter;
