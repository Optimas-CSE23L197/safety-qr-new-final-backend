import axios from 'axios';
import { SmsProvider } from './sms.provider.js';

export class MSG91Adapter extends SmsProvider {
  constructor(config = {}) {
    super();
    this.authKey = config.AUTH_KEY ?? process.env.MSG91_AUTH_KEY;
    this.senderId = config.SENDER_ID ?? process.env.MSG91_SENDER_ID ?? 'RESQID';
    this.route = config.ROUTE ?? process.env.MSG91_ROUTE ?? '4';
    this.country = config.COUNTRY ?? process.env.MSG91_COUNTRY ?? '91';
    this.baseUrl = 'https://api.msg91.com/api/v5';
    this.templates = new Map();
  }

  registerTemplate(name, template) {
    this.templates.set(name, template);
  }

  /** @private */
  _renderTemplate(templateName, data) {
    const template = this.templates.get(templateName);
    if (!template) {
      throw new Error(`[SMS] Template "${templateName}" is not registered.`);
    }
    return Object.entries(data).reduce(
      (msg, [key, value]) => msg.replace(new RegExp(`{{${key}}}`, 'g'), value),
      template
    );
  }

  async send(phoneNumber, message) {
    try {
      const response = await axios.post(
        `${this.baseUrl}/flow/`,
        {
          sender: this.senderId,
          mobiles: phoneNumber,
          message,
          route: this.route,
          country: this.country,
        },
        {
          headers: {
            authkey: this.authKey,
            'Content-Type': 'application/json',
          },
        }
      );

      const messageId = response.data?.message_id;
      console.info(`[SMS] Message dispatched to ${phoneNumber} — ID: ${messageId}`);
      return { success: true, messageId };
    } catch (err) {
      console.error(`[SMS] Failed to send to ${phoneNumber}:`, err.message);
      throw err;
    }
  }

  async sendTemplate(phoneNumber, template, data) {
    const message = this._renderTemplate(template, data);
    return this.send(phoneNumber, message);
  }

  async sendBulk(messages) {
    return Promise.all(
      messages.map(({ phone, message }) =>
        this.send(phone, message)
          .then(result => ({ success: true, phone, ...result }))
          .catch(err => ({ success: false, phone, error: err.message }))
      )
    );
  }

  async getStatus(messageId) {
    try {
      const response = await axios.get(`${this.baseUrl}/message/${messageId}`, {
        headers: { authkey: this.authKey },
      });
      return response.data;
    } catch (err) {
      console.error(`[SMS] Failed to retrieve status for message "${messageId}":`, err.message);
      throw err;
    }
  }
}

export default MSG91Adapter;
