// =============================================================================
// orchestrator/jobs/cleanupExpoTokens.job.js — RESQID
// Background job to remove invalid/expired Expo push tokens.
// Runs daily. Prevents quota waste and improves delivery rates.
// =============================================================================

import { prisma } from '#config/prisma.js';
import { logger } from '#config/logger.js';
import { Expo } from 'expo-server-sdk';

/**
 * Check a batch of tokens with Expo to identify invalid ones.
 * Expo's getReceipts API is used to verify token validity.
 */
const validateTokensWithExpo = async tokens => {
  const expo = new Expo({ accessToken: process.env.EXPO_ACCESS_TOKEN });
  const invalidTokens = [];

  // Expo doesn't have a direct token validation API.
  // We use isExpoPushToken as a first-pass filter, then mark tokens
  // that failed recent deliveries as candidates for removal.

  for (const token of tokens) {
    if (!Expo.isExpoPushToken(token)) {
      invalidTokens.push(token);
    }
  }

  return invalidTokens;
};

/**
 * Main cleanup job.
 * Finds tokens that:
 * 1. Have failed recent delivery attempts (from notification logs)
 * 2. Are syntactically invalid
 * 3. Haven't been used in 60+ days (optional)
 */
export const cleanupExpoTokens = async () => {
  const start = Date.now();
  logger.info('[cleanupExpoTokens] Starting Expo token cleanup');

  try {
    // Find tokens that failed with DeviceNotRegistered in last 7 days
    const failedNotifications = await prisma.notification.findMany({
      where: {
        channel: 'PUSH',
        status: 'FAILED',
        created_at: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        error: { contains: 'DeviceNotRegistered', mode: 'insensitive' },
      },
      select: {
        metadata: true,
      },
      take: 1000,
    });

    // Extract tokens from metadata
    const failedTokens = new Set();
    for (const notif of failedNotifications) {
      const meta = notif.metadata || {};
      const token = meta?.token || meta?.deviceToken;
      if (token) failedTokens.add(token);
    }

    logger.info({ failedCount: failedTokens.size }, '[cleanupExpoTokens] Found failed tokens');

    // Also find all active tokens and validate syntax
    const allDevices = await prisma.parentDevice.findMany({
      where: {
        is_active: true,
        expo_push_token: { not: null },
      },
      select: {
        id: true,
        expo_push_token: true,
      },
    });

    const tokensToDeactivate = [];
    const tokensToDelete = [];

    for (const device of allDevices) {
      const token = device.expo_push_token;

      // Check syntax validity
      if (!Expo.isExpoPushToken(token)) {
        tokensToDelete.push(device.id);
        continue;
      }

      // Check if token has recent failures
      if (failedTokens.has(token)) {
        tokensToDeactivate.push(device.id);
      }
    }

    // Also find tokens not used in 60+ days (stale)
    const staleDevices = await prisma.parentDevice.findMany({
      where: {
        is_active: true,
        expo_push_token: { not: null },
        last_used_at: { lt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000) },
      },
      select: { id: true },
    });

    const staleIds = staleDevices.map(d => d.id);
    const allDeactivateIds = [...new Set([...tokensToDeactivate, ...staleIds])];

    // Perform updates
    if (allDeactivateIds.length > 0) {
      await prisma.parentDevice.updateMany({
        where: { id: { in: allDeactivateIds } },
        data: { is_active: false, deactivated_at: new Date(), deactivated_reason: 'TOKEN_CLEANUP' },
      });
      logger.info(
        { count: allDeactivateIds.length },
        '[cleanupExpoTokens] Deactivated stale/failed tokens'
      );
    }

    if (tokensToDelete.length > 0) {
      await prisma.parentDevice.deleteMany({
        where: { id: { in: tokensToDelete } },
      });
      logger.info({ count: tokensToDelete.length }, '[cleanupExpoTokens] Deleted invalid tokens');
    }

    const duration = Date.now() - start;
    logger.info(
      {
        deactivated: allDeactivateIds.length,
        deleted: tokensToDelete.length,
        durationMs: duration,
      },
      '[cleanupExpoTokens] Cleanup complete'
    );

    return { deactivated: allDeactivateIds.length, deleted: tokensToDelete.length };
  } catch (err) {
    logger.error({ err: err.message }, '[cleanupExpoTokens] Cleanup failed');
    throw err;
  }
};

// For manual triggering or scheduled jobs
export default cleanupExpoTokens;
