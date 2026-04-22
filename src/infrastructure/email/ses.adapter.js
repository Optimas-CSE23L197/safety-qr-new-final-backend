import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { EmailProvider } from './email.provider.js';
import { logger } from '#config/logger.js';

export class SesAdapter extends EmailProvider {
  constructor(config = {}) {
    super();
    this.client = new SESClient({
      region: config.AWS_SES_REGION ?? process.env.AWS_SES_REGION ?? 'ap-south-1',
      credentials: {
        accessKeyId: config.AWS_SES_ACCESS_KEY ?? process.env.AWS_SES_ACCESS_KEY,
        secretAccessKey: config.AWS_SES_SECRET_KEY ?? process.env.AWS_SES_SECRET_KEY,
      },
    });
    this.defaultFrom =
      config.FROM_EMAIL ?? process.env.SES_FROM_EMAIL ?? 'RESQID <noreply@getresqid.in>';
    this.templates = new Map();
  }

  registerTemplate(name, template) {
    this.templates.set(name, template);
  }

  _renderTemplate(templateName, data) {
    const template = this.templates.get(templateName);
    if (!template) throw new Error(`[Email] Template "${templateName}" not registered.`);

    let { html, text } = template;
    for (const [key, value] of Object.entries(data)) {
      const pattern = new RegExp(`{{${key}}}`, 'g');
      if (html) html = html.replace(pattern, value);
      if (text) text = text.replace(pattern, value);
    }
    return { html, text };
  }

  async send({ to, subject, html, text, from, replyTo }) {
    const source = from ?? this.defaultFrom;
    const recipients = Array.isArray(to) ? to : [to];

    try {
      const command = new SendEmailCommand({
        Source: source,
        Destination: { ToAddresses: recipients },
        Message: {
          Subject: { Data: subject, Charset: 'UTF-8' },
          Body: {
            Html: { Data: html, Charset: 'UTF-8' },
            ...(text && { Text: { Data: text, Charset: 'UTF-8' } }),
          },
        },
        ...(replyTo && { ReplyToAddresses: [replyTo] }),
      });

      const response = await this.client.send(command);
      logger.info({ to: recipients, messageId: response.MessageId }, '[Email] Sent via SES');
      return { success: true, id: response.MessageId };
    } catch (err) {
      logger.error({ to: recipients, error: err.message }, '[Email] SES send failed');
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
    const results = await Promise.allSettled(emails.map(e => this.send(e)));
    return results.map((r, i) =>
      r.status === 'fulfilled'
        ? r.value
        : { success: false, error: r.reason?.message, to: emails[i]?.to }
    );
  }
}

export default SesAdapter;
