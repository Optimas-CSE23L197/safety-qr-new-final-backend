/**
 * SMS Provider Interface
 * Defines the contract for all SMS adapter implementations.
 */
export class SmsProvider {
  async send(phoneNumber, message, options) {
    throw new Error('SmsProvider.send() is not implemented.');
  }

  async sendOtp(phoneNumber, otp) {
    throw new Error('SmsProvider.sendOtp() is not implemented.');
  }

  async verifyOtp(identifier, otp) {
    throw new Error('SmsProvider.verifyOtp() is not implemented.');
  }

  async sendBulk(messages) {
    throw new Error('SmsProvider.sendBulk() is not implemented.');
  }

  async getStatus(messageId) {
    throw new Error('SmsProvider.getStatus() is not implemented.');
  }
}

export default SmsProvider;
