// =============================================================================
// infrastructure/push/expo.adapter.js — RESQID
// Expo Push Notification adapter.
// FIXED: Added Expo access token for enhanced security.
// =============================================================================

import { Expo } from 'expo-server-sdk';
import { PushProvider } from './push.provider.js';
import { logger } from '#config/logger.js';

export class ExpoAdapter extends PushProvider {
  constructor() {
    super();
    // FIXED: Pass access token for enhanced security
    this.expo = new Expo({
      accessToken: process.env.EXPO_ACCESS_TOKEN,
    });
  }

  /**
   * Send to a single Expo push token
   */
  async sendToDevice(deviceToken, notification) {
    if (!Expo.isExpoPushToken(deviceToken)) {
      logger.warn({ deviceToken: deviceToken.slice(0, 10) + '…' }, '[Expo] Invalid token');
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

    try {
      const chunks = this.expo.chunkPushNotifications(messages);
      let successCount = 0;
      let failureCount = 0;

      for (const chunk of chunks) {
        const tickets = await this.expo.sendPushNotificationsAsync(chunk);
        for (const ticket of tickets) {
          if (ticket.status === 'ok') successCount++;
          else failureCount++;
        }
      }

      return {
        success: successCount > 0,
        successCount,
        failureCount,
      };
    } catch (err) {
      logger.error({ err: err.message }, '[Expo] sendToDevice failed');
      return { success: false, error: err.message, successCount: 0, failureCount: 1 };
    }
  }

  /**
   * Send to multiple Expo push tokens
   */
  async sendToDevices(deviceTokens, notification) {
    const validTokens = deviceTokens.filter(t => {
      const valid = Expo.isExpoPushToken(t);
      if (!valid) logger.warn({ token: t.slice(0, 10) + '…' }, '[Expo] Invalid token filtered');
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

    try {
      const chunks = this.expo.chunkPushNotifications(messages);
      let successCount = 0;
      let failureCount = 0;

      for (const chunk of chunks) {
        const tickets = await this.expo.sendPushNotificationsAsync(chunk);
        for (const ticket of tickets) {
          if (ticket.status === 'ok') successCount++;
          else failureCount++;
        }
      }

      logger.info(
        { successCount, failureCount, total: validTokens.length },
        '[Expo] Multicast complete'
      );
      return { success: successCount > 0, successCount, failureCount };
    } catch (err) {
      logger.error({ err: err.message }, '[Expo] sendToDevices failed');
      return {
        success: false,
        error: err.message,
        successCount: 0,
        failureCount: validTokens.length,
      };
    }
  }

  // Topics not supported by Expo — no-op with warning
  async sendToTopic(topic) {
    logger.warn({ topic }, '[Expo] sendToTopic not supported');
    return { success: false, error: 'Topics not supported by Expo' };
  }

  async subscribeToTopic(deviceTokens, topic) {
    logger.warn({ topic }, '[Expo] subscribeToTopic not supported');
    return null;
  }

  async unsubscribeFromTopic(deviceTokens, topic) {
    logger.warn({ topic }, '[Expo] unsubscribeFromTopic not supported');
    return null;
  }
}

export default ExpoAdapter;
