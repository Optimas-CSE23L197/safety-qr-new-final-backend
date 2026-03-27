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

  async sendToTopic(topic, notification) {
    throw new Error('PushProvider.sendToTopic() is not implemented.');
  }

  async subscribeToTopic(deviceTokens, topic) {
    throw new Error('PushProvider.subscribeToTopic() is not implemented.');
  }

  async unsubscribeFromTopic(deviceTokens, topic) {
    throw new Error('PushProvider.unsubscribeFromTopic() is not implemented.');
  }
}

export default PushProvider;
