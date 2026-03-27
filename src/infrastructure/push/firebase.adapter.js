import admin from 'firebase-admin';
import { PushProvider } from './push.provider.js';

export class FirebaseAdapter extends PushProvider {
  constructor(config = {}) {
    super();

    if (!admin.apps.length) {
      const serviceAccount =
        config.serviceAccount ?? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        ...config,
      });
    }

    this.messaging = admin.messaging();
  }

  async sendToDevice(deviceToken, notification) {
    try {
      const message = {
        token: deviceToken,
        notification: {
          title: notification.title,
          body: notification.body,
        },
        data: notification.data ?? {},
        android: { priority: 'high' },
        apns: { payload: { aps: { sound: 'default' } } },
      };

      const messageId = await this.messaging.send(message);
      console.info(`[Push] Notification delivered to device "${deviceToken}" — ID: ${messageId}`);
      return { success: true, messageId };
    } catch (err) {
      console.error(`[Push] Failed to send to device "${deviceToken}":`, err.message);
      throw err;
    }
  }

  async sendToDevices(deviceTokens, notification) {
    try {
      const message = {
        tokens: deviceTokens,
        notification: { title: notification.title, body: notification.body },
        data: notification.data ?? {},
      };

      const response = await this.messaging.sendEachForMulticast(message);

      const results = {
        successCount: response.successCount,
        failureCount: response.failureCount,
        responses: response.responses.map((resp, i) => ({
          success: resp.success,
          error: resp.error?.message ?? null,
          token: deviceTokens[i],
        })),
      };

      console.info(
        `[Push] Multicast complete — ${results.successCount} succeeded, ${results.failureCount} failed out of ${deviceTokens.length} devices.`
      );
      return results;
    } catch (err) {
      console.error('[Push] Multicast send failed:', err.message);
      throw err;
    }
  }

  async sendToTopic(topic, notification) {
    try {
      const message = {
        topic,
        notification: { title: notification.title, body: notification.body },
        data: notification.data ?? {},
      };

      const messageId = await this.messaging.send(message);
      console.info(`[Push] Notification sent to topic "${topic}" — ID: ${messageId}`);
      return { success: true, messageId };
    } catch (err) {
      console.error(`[Push] Failed to send to topic "${topic}":`, err.message);
      throw err;
    }
  }

  async subscribeToTopic(deviceTokens, topic) {
    try {
      const response = await this.messaging.subscribeToTopic(deviceTokens, topic);
      console.info(`[Push] ${deviceTokens.length} device(s) subscribed to topic "${topic}".`);
      return response;
    } catch (err) {
      console.error(`[Push] Topic subscription failed for "${topic}":`, err.message);
      throw err;
    }
  }

  async unsubscribeFromTopic(deviceTokens, topic) {
    try {
      const response = await this.messaging.unsubscribeFromTopic(deviceTokens, topic);
      console.info(`[Push] ${deviceTokens.length} device(s) unsubscribed from topic "${topic}".`);
      return response;
    } catch (err) {
      console.error(`[Push] Topic unsubscription failed for "${topic}":`, err.message);
      throw err;
    }
  }
}

export default FirebaseAdapter;
