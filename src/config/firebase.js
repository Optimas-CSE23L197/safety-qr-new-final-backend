// =============================================================================
// firebase.js — RESQID
// Firebase Admin SDK — FCM push notifications
//
// Schema references:
//   ParentDevice.device_token    — FCM/APNS registration token
//   ParentDevice.platform        — IOS | ANDROID | WEB
//   ParentNotificationPref.scan_notify_push
//   ParentNotificationPref.anomaly_notify_push
//
// Features:
//   - Single Firebase Admin app instance (prevents duplicate-app errors)
//   - sendPushNotification() — single device
//   - sendMulticast()        — up to 500 devices in one API call (battery efficient)
//   - Dev mode: logs instead of sending (no Firebase credentials required locally)
//   - Automatic handling of invalid/expired tokens (remove from DB)
// =============================================================================

import admin from "firebase-admin";
import { ENV } from "./env.js";
import { logger } from "./logger.js";

// ─── Initialize Firebase Admin ────────────────────────────────────────────────
// Guard against hot-reload reinitializing the app (causes "app already exists" error)

let _app = null;

function getFirebaseApp() {
  if (_app) return _app;

  // Dev mode without credentials — return null (mock mode)
  if (ENV.IS_DEV && !ENV.FIREBASE_PROJECT_ID) {
    return null;
  }

  // Check if already initialized (handle module reloads)
  if (admin.apps.length > 0) {
    _app = admin.apps[0];
    return _app;
  }

  _app = admin.initializeApp({
    credential: admin.credential.cert({
      projectId: ENV.FIREBASE_PROJECT_ID,
      clientEmail: ENV.FIREBASE_CLIENT_EMAIL,
      // ENV.FIREBASE_PRIVATE_KEY already has \n replaced by env.js
      privateKey: ENV.FIREBASE_PRIVATE_KEY,
    }),
  });

  logger.info(
    { type: "firebase_initialized", projectId: ENV.FIREBASE_PROJECT_ID },
    "Firebase Admin SDK initialized",
  );

  return _app;
}

// ─── Messaging Instance ───────────────────────────────────────────────────────

function getMessaging() {
  const app = getFirebaseApp();
  if (!app) return null;
  return admin.messaging(app);
}

// ─── Single Device Push ───────────────────────────────────────────────────────

/**
 * sendPushNotification(deviceToken, notification, data, platform)
 * Send a push notification to a single device
 *
 * @param {string} deviceToken - ParentDevice.device_token (FCM registration token)
 * @param {object} notification
 * @param {string} notification.title - Notification title
 * @param {string} notification.body  - Notification body
 * @param {object} [data]     - Custom key-value data payload (string values only)
 * @param {string} [platform] - "IOS" | "ANDROID" | "WEB" — for platform-specific config
 * @returns {{ success: boolean, messageId?: string, error?: string }}
 */
export async function sendPushNotification(
  deviceToken,
  notification,
  data = {},
  platform = "ANDROID",
) {
  const messaging = getMessaging();

  // Dev mock — log instead of send
  if (!messaging) {
    logger.info(
      {
        type: "fcm_dev_mock",
        deviceToken: deviceToken.slice(0, 16) + "...",
        notification,
      },
      "Firebase [DEV]: push notification (not sent)",
    );
    return { success: true, messageId: "dev-mock-message-id" };
  }

  // Stringify all data values — FCM requires string values
  const stringData = Object.fromEntries(
    Object.entries(data).map(([k, v]) => [k, String(v)]),
  );

  const message = {
    token: deviceToken,
    notification: {
      title: notification.title,
      body: notification.body,
    },
    data: stringData,
    // Platform-specific config
    ...(platform === "IOS" && {
      apns: {
        payload: { aps: { sound: "default", badge: 1 } },
        headers: { "apns-priority": "10" },
      },
    }),
    ...(platform === "ANDROID" && {
      android: {
        priority: "high",
        notification: { sound: "default", channelId: "resqid_alerts" },
      },
    }),
  };

  try {
    const messageId = await messaging.send(message);

    logger.info(
      { type: "fcm_sent", messageId, platform },
      "Firebase: push notification sent",
    );

    return { success: true, messageId };
  } catch (err) {
    // Check if token is invalid/expired — caller should remove from DB
    const isInvalidToken = isTokenInvalidError(err);

    logger.warn(
      {
        type: "fcm_send_failed",
        err: err.message,
        code: err.code,
        isInvalidToken,
      },
      "Firebase: push notification failed",
    );

    return { success: false, error: err.message, isInvalidToken };
  }
}

// ─── Multicast Push ───────────────────────────────────────────────────────────

/**
 * sendMulticast(deviceTokens, notification, data)
 * Send the same notification to up to 500 devices in one API call
 * Returns list of invalid tokens to remove from DB
 *
 * @param {string[]} deviceTokens - Array of FCM tokens (max 500)
 * @param {object} notification   - { title, body }
 * @param {object} [data]         - Custom data payload
 * @returns {{ successCount: number, failureCount: number, invalidTokens: string[] }}
 */
export async function sendMulticast(deviceTokens, notification, data = {}) {
  if (!deviceTokens.length)
    return { successCount: 0, failureCount: 0, invalidTokens: [] };

  const messaging = getMessaging();

  if (!messaging) {
    logger.info(
      { type: "fcm_multicast_dev_mock", count: deviceTokens.length },
      `Firebase [DEV]: multicast to ${deviceTokens.length} devices (not sent)`,
    );
    return {
      successCount: deviceTokens.length,
      failureCount: 0,
      invalidTokens: [],
    };
  }

  const stringData = Object.fromEntries(
    Object.entries(data).map(([k, v]) => [k, String(v)]),
  );

  // Split into batches of 500 (FCM limit)
  const batches = chunk(deviceTokens, 500);
  const invalidTokens = [];
  let successCount = 0;
  let failureCount = 0;

  for (const batch of batches) {
    const message = {
      tokens: batch,
      notification: { title: notification.title, body: notification.body },
      data: stringData,
      android: {
        priority: "high",
        notification: { sound: "default", channelId: "resqid_alerts" },
      },
    };

    const response = await messaging.sendEachForMulticast(message);

    successCount += response.successCount;
    failureCount += response.failureCount;

    // Collect invalid tokens to remove from DB
    response.responses.forEach((result, index) => {
      if (!result.success && isTokenInvalidError(result.error)) {
        invalidTokens.push(batch[index]);
      }
    });
  }

  logger.info(
    {
      type: "fcm_multicast_done",
      successCount,
      failureCount,
      invalidCount: invalidTokens.length,
    },
    "Firebase: multicast complete",
  );

  return { successCount, failureCount, invalidTokens };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isTokenInvalidError(err) {
  const invalidCodes = [
    "messaging/invalid-registration-token",
    "messaging/registration-token-not-registered",
    "messaging/invalid-argument",
  ];
  return invalidCodes.includes(err?.code);
}

function chunk(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}
