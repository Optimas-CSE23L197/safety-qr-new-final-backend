// infrastructure/email/brevo.adapter.js
import axios from 'axios';
import { EmailProvider } from './email.provider.js';
import { logger } from '#config/logger.js';

function parseSender(from) {
  const match = from.match(/^(.+?)\s*<(.+)>$/);
  if (match) return { name: match[1].trim(), email: match[2].trim() };
  return { name: 'RESQID', email: from.trim() };
}

export class BrevoAdapter extends EmailProvider {
  constructor(config = {}) {
    super();
    this.apiKey = config.BREVO_API_KEY ?? process.env.BREVO_API_KEY;
    this.defaultFrom =
      config.FROM_EMAIL ?? process.env.BREVO_FROM_EMAIL ?? 'RESQID <noreply@getresqid.in>';
    this.baseUrl = 'https://api.brevo.com/v3';
  }

  async send({ to, subject, html, text, from, replyTo }) {
    const sender = parseSender(from ?? this.defaultFrom); // fixed: was hardcoding name
    const recipients = Array.isArray(to) ? to : [to];

    try {
      await axios.post(
        `${this.baseUrl}/smtp/email`,
        {
          sender,
          to: recipients.map(email => ({ email })),
          subject,
          htmlContent: html,
          ...(text && { textContent: text }),
          ...(replyTo && { replyTo: { email: replyTo } }),
        },
        {
          headers: {
            'api-key': this.apiKey,
            'Content-Type': 'application/json',
          },
        }
      );

      logger.info({ to: recipients }, '[Email] Sent via Brevo');
      return { success: true };
    } catch (err) {
      logger.error(
        { to: recipients, error: err.response?.data || err.message },
        '[Email] Brevo send failed'
      );
      return { success: false, error: err.message };
    }
  }

  async sendReactTemplate(Component, props = {}, { to, subject, from, replyTo } = {}) {
    try {
      // Import render dynamically — only if react-email installed
      const { render } = await import('@react-email/components');
      const element = Component(props);
      const html = await render(element);
      const text = await render(element, { plainText: true });
      return this.send({ to, subject, html, text, from, replyTo });
    } catch (err) {
      logger.error({ error: err.message, to }, '[Email] Brevo template render/send failed');
      return { success: false, error: err.message };
    }
  }

  async sendBulk(emails) {
    const results = await Promise.allSettled(emails.map(e => this.send(e)));
    return results.map((r, i) =>
      r.status === 'fulfilled'
        ? r.value
        : { success: false, error: r.reason?.message, to: emails[i]?.to }
    );
  }
}

export default BrevoAdapter;
