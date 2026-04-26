/**
 * Push Notification Provider Interface
 * Defines the contract for all push adapter implementations.
 */
export class PushProvider {
  async sendToDevice(deviceToken, notification) {
    throw new Error('PushProvider.sendToDevice() is not implemented.');
  }

  async sendToDevices(deviceTokens, notification) {
    throw new Error('PushProvider.sendToDevices() is not implemented.');
  }
}

export default PushProvider;
