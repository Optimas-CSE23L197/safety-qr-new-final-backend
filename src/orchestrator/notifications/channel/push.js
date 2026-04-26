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

    // ExpoAdapter handles chunking internally
    const result = await push.sendToDevices(tokenList, { title, body, data });

    logger.info(
      {
        tokenCount: tokenList.length,
        successCount: result?.successCount ?? 0,
        failureCount: result?.failureCount ?? 0,
        latencyMs: Date.now() - start,
        ...meta,
      },
      '[push] Push sent'
    );

    return {
      success: (result?.successCount ?? 0) > 0,
      successCount: result?.successCount ?? 0,
      failureCount: result?.failureCount ?? 0,
    };
  } catch (err) {
    logger.error(
      { err: err.message, latencyMs: Date.now() - start, ...meta },
      '[push] Push failed'
    );
    return { success: false, error: err.message };
  }
};
