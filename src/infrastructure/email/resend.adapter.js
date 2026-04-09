import { Resend } from 'resend';
import { EmailProvider } from './email.provider.js';
import { logger } from '#config/logger.js';

export class ResendAdapter extends EmailProvider {
  constructor(config = {}) {
    super();
    this.client = new Resend(config.API_KEY || process.env.RESEND_API_KEY);
    this.defaultFrom =
      config.FROM_EMAIL || process.env.RESEND_FROM_EMAIL || 'RESQID <noreply@mail.getresqid.in>';
    this.templates = new Map();
  }

  registerTemplate(name, template) {
    this.templates.set(name, template);
  }

  /** @private */
  _renderTemplate(templateName, data) {
    const template = this.templates.get(templateName);
    if (!template) {
      throw new Error(`[Email] Template "${templateName}" is not registered.`);
    }

    let { html, text } = template;
    for (const [key, value] of Object.entries(data)) {
      const pattern = new RegExp(`{{${key}}}`, 'g');
      if (html) html = html.replace(pattern, value);
      if (text) text = text.replace(pattern, value);
    }
    return { html, text };
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

      logger.info({ to: recipients, id: response.id }, '[Email] Sent successfully');
      return { success: true, id: response.id };
    } catch (err) {
      logger.error({ to: recipients, error: err.message }, '[Email] Send failed');
      return { success: false, error: err.message };
    }
  }

  async sendTemplate(template, data, to, subject) {
    try {
      const { html, text } = this._renderTemplate(template, data);
      return await this.send({ to, subject, html, text });
    } catch (err) {
      logger.error({ template, to, error: err.message }, '[Email] Template send failed');
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
