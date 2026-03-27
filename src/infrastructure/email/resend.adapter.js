import { Resend } from 'resend';
import { EmailProvider } from './email.provider.js';

export class ResendAdapter extends EmailProvider {
  constructor(config = {}) {
    super();
    this.client = new Resend(config.API_KEY || process.env.RESEND_API_KEY);
    this.defaultFrom = config.FROM_EMAIL || process.env.RESEND_FROM_EMAIL || 'noreply@resqid.com';
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

      console.info(`[Email] Sent to [${recipients.join(', ')}] — ID: ${response.id}`);
      return { success: true, id: response.id };
    } catch (err) {
      console.error(`[Email] Failed to send to [${recipients.join(', ')}]:`, err.message);
      throw err;
    }
  }

  async sendTemplate(template, data, to, subject) {
    const { html, text } = this._renderTemplate(template, data);
    return this.send({ to, subject, html, text });
  }

  async sendBulk(emails) {
    return Promise.all(
      emails.map(email => this.send(email).catch(err => ({ success: false, error: err.message })))
    );
  }
}

export default ResendAdapter;
