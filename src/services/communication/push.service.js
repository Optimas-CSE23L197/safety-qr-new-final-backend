// =============================================================================
// push.service.js — RESQID
// Environment-aware Push Notification service (FCM)
// DEV logs only, PROD sends via Firebase Cloud Messaging
// =============================================================================

import { logger } from '#config/logger.js';

const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PRODUCTION = NODE_ENV === 'production';

// Push notification configuration
const PUSH_CONFIG = {
  projectId: process.env.FCM_PROJECT_ID,
  privateKey: process.env.FCM_PRIVATE_KEY,
  clientEmail: process.env.FCM_CLIENT_EMAIL,
};

let fcmApp = null;
let fcmMessaging = null;

/**
 * Initialize Firebase Admin SDK (lazy load)
 */
const initFirebase = async () => {
  if (!IS_PRODUCTION) return null;
  if (fcmMessaging) return fcmMessaging;

  try {
    const admin = await import('firebase-admin');

    if (!admin.apps.length) {
      // For production, use service account
      if (PUSH_CONFIG.privateKey && PUSH_CONFIG.projectId) {
        fcmApp = admin.initializeApp({
          credential: admin.credential.cert({
            projectId: PUSH_CONFIG.projectId,
            privateKey: PUSH_CONFIG.privateKey.replace(/\\n/g, '\n'),
            clientEmail: PUSH_CONFIG.clientEmail,
          }),
        });
      } else {
        // For development with Firebase emulator
        fcmApp = admin.initializeApp({
          projectId: 'resqid-dev',
        });
      }
    } else {
      fcmApp = admin.app();
    }

    fcmMessaging = fcmApp.messaging();
    logger.info({ msg: 'Firebase Cloud Messaging initialized' });
    return fcmMessaging;
  } catch (error) {
    logger.error({
      msg: 'Failed to initialize Firebase',
      error: error.message,
    });
    return null;
  }
};

/**
 * Validate device token format
 */
const isValidToken = token => {
  return token && typeof token === 'string' && token.length > 10;
};

/**
 * Send push notification to a single device
 * @param {string} deviceToken - FCM device token
 * @param {string} title - Notification title
 * @param {string} body - Notification body
 * @param {object} data - Additional data payload
 * @returns {Promise<{success: boolean, messageId?: string, simulated?: boolean}>}
 */
export const sendPush = async (deviceToken, title, body, data = {}) => {
  // Validate input
  if (!deviceToken || !title || !body) {
    throw new Error('Missing required push parameters: deviceToken, title, body');
  }

  if (!isValidToken(deviceToken)) {
    logger.warn({
      msg: 'Invalid device token format',
      token: deviceToken.slice(0, 10),
    });
    throw new Error('Invalid device token');
  }

  // Sanitize input
  const sanitizedTitle = title.slice(0, 100);
  const sanitizedBody = body.slice(0, 200);

  // DEVELOPMENT MODE: Log only
  if (!IS_PRODUCTION) {
    logger.info({
      msg: '[DEV] Push notification would send:',
      deviceToken: `${deviceToken.slice(0, 10)}...`,
      title: sanitizedTitle,
      body: sanitizedBody,
      data,
    });
    return {
      success: true,
      simulated: true,
      messageId: `dev-${Date.now()}`,
    };
  }

  // PRODUCTION MODE: Send real push
  try {
    const messaging = await initFirebase();
    if (!messaging) {
      throw new Error('Firebase Messaging not initialized');
    }

    const message = {
      token: deviceToken,
      notification: {
        title: sanitizedTitle,
        body: sanitizedBody,
      },
      data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
      android: {
        priority: 'high',
        notification: {
          sound: 'default',
          channelId: 'resqid_default',
        },
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
          },
        },
      },
    };

    const response = await messaging.send(message);

    logger.info({
      msg: 'Push notification sent successfully',
      deviceToken: `${deviceToken.slice(0, 10)}...`,
      messageId: response,
    });

    return {
      success: true,
      messageId: response,
    };
  } catch (error) {
    logger.error({
      msg: 'Failed to send push notification',
      deviceToken: `${deviceToken.slice(0, 10)}...`,
      error: error.message,
    });

    // Handle specific FCM errors
    if (error.code === 'messaging/registration-token-not-registered') {
      // Token is invalid - should be removed from database
      return {
        success: false,
        error: 'Invalid device token',
        invalidToken: true,
      };
    }

    throw new Error(`Push notification failed: ${error.message}`);
  }
};

/**
 * Send push notification to multiple devices
 * @param {Array<string>} deviceTokens - List of FCM device tokens
 * @param {string} title - Notification title
 * @param {string} body - Notification body
 * @param {object} data - Additional data payload
 * @returns {Promise<Array<{token: string, success: boolean, error?: string}>>}
 */
export const sendMulticastPush = async (deviceTokens, title, body, data = {}) => {
  if (!deviceTokens || deviceTokens.length === 0) {
    return [];
  }

  // Filter valid tokens
  const validTokens = deviceTokens.filter(isValidToken);

  if (validTokens.length === 0) {
    logger.warn({ msg: 'No valid device tokens provided' });
    return deviceTokens.map(token => ({
      token,
      success: false,
      error: 'Invalid token',
    }));
  }

  const results = [];

  // DEVELOPMENT MODE: Log only
  if (!IS_PRODUCTION) {
    logger.info({
      msg: '[DEV] Multicast push would send:',
      tokenCount: validTokens.length,
      title,
      body,
    });
    return validTokens.map(token => ({
      token,
      success: true,
      simulated: true,
    }));
  }

  // PRODUCTION MODE: Send real multicast
  try {
    const messaging = await initFirebase();
    if (!messaging) {
      throw new Error('Firebase Messaging not initialized');
    }

    const message = {
      tokens: validTokens,
      notification: {
        title: title.slice(0, 100),
        body: body.slice(0, 200),
      },
      data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
    };

    const response = await messaging.sendEachForMulticast(message);

    // Process results
    for (let i = 0; i < validTokens.length; i++) {
      const result = response.responses[i];
      results.push({
        token: validTokens[i],
        success: result.success,
        messageId: result.messageId,
        error: result.error?.message,
        invalidToken: result.error?.code === 'messaging/registration-token-not-registered',
      });
    }

    logger.info({
      msg: 'Multicast push sent',
      total: validTokens.length,
      successCount: results.filter(r => r.success).length,
    });

    return results;
  } catch (error) {
    logger.error({
      msg: 'Failed to send multicast push',
      error: error.message,
    });
    throw new Error(`Multicast push failed: ${error.message}`);
  }
};

/**
 * Send notification to a topic (all subscribers)
 * @param {string} topic - FCM topic name
 * @param {string} title - Notification title
 * @param {string} body - Notification body
 * @param {object} data - Additional data payload
 * @returns {Promise<{success: boolean, messageId?: string}>}
 */
export const sendTopicPush = async (topic, title, body, data = {}) => {
  if (!topic) {
    throw new Error('Topic name required');
  }

  if (!IS_PRODUCTION) {
    logger.info({
      msg: '[DEV] Topic push would send:',
      topic,
      title,
      body,
    });
    return { success: true, simulated: true };
  }

  try {
    const messaging = await initFirebase();
    if (!messaging) {
      throw new Error('Firebase Messaging not initialized');
    }

    const message = {
      topic,
      notification: {
        title: title.slice(0, 100),
        body: body.slice(0, 200),
      },
      data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
    };

    const response = await messaging.send(message);

    logger.info({
      msg: 'Topic push sent',
      topic,
      messageId: response,
    });

    return { success: true, messageId: response };
  } catch (error) {
    logger.error({
      msg: 'Failed to send topic push',
      topic,
      error: error.message,
    });
    throw new Error(`Topic push failed: ${error.message}`);
  }
};

/**
 * Subscribe device tokens to a topic
 * @param {Array<string>} deviceTokens - List of tokens
 * @param {string} topic - Topic name
 * @returns {Promise<{successCount: number, failedCount: number}>}
 */
export const subscribeToTopic = async (deviceTokens, topic) => {
  if (!deviceTokens || deviceTokens.length === 0) {
    return { successCount: 0, failedCount: 0 };
  }

  if (!IS_PRODUCTION) {
    logger.info({
      msg: '[DEV] Would subscribe to topic:',
      topic,
      tokenCount: deviceTokens.length,
    });
    return {
      successCount: deviceTokens.length,
      failedCount: 0,
      simulated: true,
    };
  }

  try {
    const messaging = await initFirebase();
    if (!messaging) {
      throw new Error('Firebase Messaging not initialized');
    }

    const response = await messaging.subscribeToTopic(deviceTokens, topic);

    logger.info({
      msg: 'Subscribed to topic',
      topic,
      successCount: response.successCount,
      failureCount: response.failureCount,
    });

    return {
      successCount: response.successCount,
      failedCount: response.failureCount,
    };
  } catch (error) {
    logger.error({
      msg: 'Failed to subscribe to topic',
      topic,
      error: error.message,
    });
    throw new Error(`Topic subscription failed: ${error.message}`);
  }
};

/**
 * Check push service health
 */
export const checkPushHealth = async () => {
  if (!IS_PRODUCTION) {
    return { status: 'ok', mode: 'development', simulated: true };
  }

  try {
    const messaging = await initFirebase();
    if (!messaging) {
      return { status: 'error', error: 'Firebase not initialized' };
    }
    return { status: 'ok', mode: 'production', provider: 'firebase' };
  } catch (error) {
    return { status: 'error', error: error.message };
  }
};

export default {
  sendPush,
  sendMulticastPush,
  sendTopicPush,
  subscribeToTopic,
  checkPushHealth,
};
