// =============================================================================
// infrastructure/push/expo.adapter.js — RESQID
// Expo Push Notification adapter. Replaces FirebaseAdapter.
// Implements the same PushProvider interface so push.js is untouched.
// =============================================================================

import { Expo } from 'expo-server-sdk';
import { PushProvider } from './push.provider.js';
import { logger } from '#config/logger.js';

export class ExpoAdapter extends PushProvider {
  constructor() {
    super();
    this.expo = new Expo();
  }

  /**
   * Send to a single Expo push token
   */
  async sendToDevice(deviceToken, notification) {
    if (!Expo.isExpoPushToken(deviceToken)) {
      logger.warn({ deviceToken }, '[ExpoAdapter] Invalid Expo push token — skipping');
      return { success: false, error: 'Invalid Expo push token', successCount: 0, failureCount: 1 };
    }

    const messages = [
      {
        to: deviceToken,
        title: notification.title,
        body: notification.body,
        data: notification.data ?? {},
        sound: 'default',
        priority: 'high',
      },
    ];

    const chunks = this.expo.chunkPushNotifications(messages);
    let successCount = 0;
    let failureCount = 0;

    for (const chunk of chunks) {
      try {
        const tickets = await this.expo.sendPushNotificationsAsync(chunk);
        for (const ticket of tickets) {
          if (ticket.status === 'ok') successCount++;
          else {
            failureCount++;
            logger.warn({ ticket }, '[ExpoAdapter] Ticket error');
          }
        }
      } catch (err) {
        failureCount++;
        logger.error({ err: err.message }, '[ExpoAdapter] sendToDevice failed');
        throw err;
      }
    }

    return { success: successCount > 0, successCount, failureCount };
  }

  /**
   * Send to multiple Expo push tokens
   */
  async sendToDevices(deviceTokens, notification) {
    const validTokens = deviceTokens.filter(t => {
      const valid = Expo.isExpoPushToken(t);
      if (!valid) logger.warn({ token: t }, '[ExpoAdapter] Invalid token filtered out');
      return valid;
    });

    if (validTokens.length === 0) {
      return {
        success: false,
        error: 'No valid Expo tokens',
        successCount: 0,
        failureCount: deviceTokens.length,
      };
    }

    const messages = validTokens.map(token => ({
      to: token,
      title: notification.title,
      body: notification.body,
      data: notification.data ?? {},
      sound: 'default',
      priority: 'high',
    }));

    const chunks = this.expo.chunkPushNotifications(messages);
    let successCount = 0;
    let failureCount = 0;

    for (const chunk of chunks) {
      try {
        const tickets = await this.expo.sendPushNotificationsAsync(chunk);
        for (const ticket of tickets) {
          if (ticket.status === 'ok') successCount++;
          else {
            failureCount++;
            logger.warn({ ticket }, '[ExpoAdapter] Ticket error');
          }
        }
      } catch (err) {
        failureCount += chunk.length;
        logger.error({ err: err.message }, '[ExpoAdapter] sendToDevices chunk failed');
        throw err;
      }
    }

    logger.info(
      { successCount, failureCount, total: validTokens.length },
      '[ExpoAdapter] Multicast complete'
    );
    return { success: successCount > 0, successCount, failureCount };
  }

  // sendToTopic / subscribeToTopic / unsubscribeFromTopic not supported by Expo
  // Kept as no-ops to satisfy PushProvider interface
  async sendToTopic(topic) {
    logger.warn({ topic }, '[ExpoAdapter] sendToTopic not supported — skipping');
    return { success: false, error: 'Topics not supported by Expo' };
  }

  async subscribeToTopic(deviceTokens, topic) {
    logger.warn({ topic }, '[ExpoAdapter] subscribeToTopic not supported — skipping');
    return null;
  }

  async unsubscribeFromTopic(deviceTokens, topic) {
    logger.warn({ topic }, '[ExpoAdapter] unsubscribeFromTopic not supported — skipping');
    return null;
  }
}

export default ExpoAdapter;
