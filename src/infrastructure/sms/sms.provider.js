/**
 * SMS Provider Interface
 * Defines the contract for all SMS adapter implementations.
 */
export class SmsProvider {
  async send(phoneNumber, message) {
    throw new Error('SmsProvider.send() is not implemented.');
  }

  async sendTemplate(phoneNumber, template, data) {
    throw new Error('SmsProvider.sendTemplate() is not implemented.');
  }

  async sendBulk(messages) {
    throw new Error('SmsProvider.sendBulk() is not implemented.');
  }

  async getStatus(messageId) {
    throw new Error('SmsProvider.getStatus() is not implemented.');
  }
}

export default SmsProvider;
