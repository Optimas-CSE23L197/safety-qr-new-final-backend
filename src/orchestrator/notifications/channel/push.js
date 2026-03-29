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
    return { success: false, error: 'No FCM tokens' };
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

    // Optional: chunk tokens if too many
    const chunkSize = 500;
    const chunks = [];
    for (let i = 0; i < tokenList.length; i += chunkSize) {
      chunks.push(tokenList.slice(i, i + chunkSize));
    }

    let successCount = 0;
    let failureCount = 0;

    for (const chunk of chunks) {
      const result =
        chunk.length === 1
          ? await push.sendToDevice(chunk[0], { title, body, data })
          : await push.sendToDevices(chunk, { title, body, data });

      successCount += result?.successCount ?? 0;
      failureCount += result?.failureCount ?? 0;
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

    return { success: true, successCount, failureCount };
  } catch (err) {
    logger.error(
      { err: err.message, latencyMs: Date.now() - start, ...meta },
      '[push] Push failed'
    );
    return { success: false, error: err.message };
  }
};
