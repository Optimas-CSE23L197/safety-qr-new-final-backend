// =============================================================================
// orchestrator/notifications/channel/push.js — RESQID
// Thin channel wrapper over ExpoAdapter.
// Handles chunking, logging, latency. Never throws.
// =============================================================================

import { getPush } from '#infrastructure/push/push.index.js';
import { logger } from '#config/logger.js';

export const sendPushNotificationChannel = async ({
  tokens,
  title,
  body,
  data = {},
  meta = {},
}) => {
  if (!tokens || !title || !body) {
    logger.warn({ meta }, '[push] Missing fields — skipping');
    return { success: false, error: 'Missing required fields' };
  }

  const tokenList = Array.isArray(tokens) ? tokens : [tokens];
  if (tokenList.length === 0) {
    return { success: false, error: 'No Expo push tokens' };
  }

  const start = Date.now();
  try {
    let push;
    try {
      push = getPush();
    } catch (err) {
      logger.error({ err: err.message, ...meta }, '[push] Provider init failed');
      return { success: false, error: 'Push provider not available' };
    }

    // Expo SDK handles its own chunking inside ExpoAdapter,
    // but we chunk here too for very large token lists (>500)
    const chunkSize = 500;
    let successCount = 0;
    let failureCount = 0;

    for (let i = 0; i < tokenList.length; i += chunkSize) {
      const chunk = tokenList.slice(i, i + chunkSize);
      const result =
        chunk.length === 1
          ? await push.sendToDevice(chunk[0], { title, body, data })
          : await push.sendToDevices(chunk, { title, body, data });

      successCount += result?.successCount ?? (result?.success ? 1 : 0);
      failureCount += result?.failureCount ?? (result?.success ? 0 : 1);
    }

    logger.info(
      {
        tokenCount: tokenList.length,
        successCount,
        failureCount,
        latencyMs: Date.now() - start,
        ...meta,
      },
      '[push] Push sent'
    );

    return { success: successCount > 0, successCount, failureCount };
  } catch (err) {
    logger.error(
      { err: err.message, latencyMs: Date.now() - start, ...meta },
      '[push] Push failed'
    );
    return { success: false, error: err.message };
  }
};
