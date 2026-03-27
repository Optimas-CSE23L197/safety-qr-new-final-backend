/**
 * Email Provider Interface
 * Defines the contract for all email adapter implementations.
 */
export class EmailProvider {
  async send(options) {
    throw new Error('EmailProvider.send() is not implemented.');
  }

  async sendTemplate(template, data, to, subject) {
    throw new Error('EmailProvider.sendTemplate() is not implemented.');
  }

  async sendBulk(emails) {
    throw new Error('EmailProvider.sendBulk() is not implemented.');
  }
}

export default EmailProvider;
