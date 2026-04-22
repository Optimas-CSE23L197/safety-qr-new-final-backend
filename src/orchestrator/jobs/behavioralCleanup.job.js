// =============================================================================
// orchestrator/jobs/behavioral.cleanup.job.js — RESQID
// Nightly cleanup cron — runs at 2 AM IST every night.
// =============================================================================

import { prisma } from '#config/prisma.js';
import { redis } from '#config/redis.js';
import { logger } from '#config/logger.js';
import { behavioralCleanup } from '#middleware/security/behavioralSecurity.middleware.js';

/**
 * Scan Redis keys safely using cursor — O(1) per batch, non-blocking.
 */
const scanKeys = async pattern => {
  const keys = [];
  let cursor = '0';
  do {
    const [nextCursor, batch] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
    cursor = nextCursor;
    keys.push(...batch);
  } while (cursor !== '0');
  return keys;
};

export const runBehavioralCleanup = async () => {
  const startTime = Date.now();
  const summary = {};

  logger.info({ job: 'behavioral_cleanup' }, '[behavioral.cleanup] Job started');

  // 1. Expired OTPs
  try {
    const otpKeys = await scanKeys('otp:*');
    let deletedOtps = 0;
    for (const key of otpKeys) {
      const ttl = await redis.ttl(key);
      if (ttl === -1) {
        await redis.del(key);
        deletedOtps++;
      }
    }
    summary.deletedOtpKeys = deletedOtps;
    logger.info({ count: deletedOtps }, '[behavioral.cleanup] OTP key cleanup done');
  } catch (err) {
    logger.error({ err: err.message }, '[behavioral.cleanup] OTP cleanup failed');
    summary.otpCleanupError = err.message;
  }

  // 2. Expired sessions
  try {
    const result = await prisma.session.deleteMany({
      where: { OR: [{ expires_at: { lt: new Date() } }, { is_revoked: true }] },
    });
    summary.deletedSessions = result.count;
    logger.info({ count: result.count }, '[behavioral.cleanup] Session cleanup done');
  } catch (err) {
    logger.error({ err: err.message }, '[behavioral.cleanup] Session cleanup failed');
    summary.sessionCleanupError = err.message;
  }

  // 3. Expired blacklisted tokens
  try {
    const result = await prisma.blacklistedToken.deleteMany({
      where: { expires_at: { lt: new Date() } },
    });
    summary.deletedBlacklistedTokens = result.count;
    logger.info({ count: result.count }, '[behavioral.cleanup] Blacklisted token cleanup done');
  } catch (err) {
    logger.error({ err: err.message }, '[behavioral.cleanup] Blacklisted token cleanup failed');
    summary.blacklistCleanupError = err.message;
  }

  // 4. Expired rate limit records
  try {
    const result = await prisma.scanRateLimit.deleteMany({
      where: { blocked_until: { lt: new Date() }, blocked_reason: { not: null } },
    });
    summary.deletedRateLimitRecords = result.count;
    logger.info({ count: result.count }, '[behavioral.cleanup] Rate limit cleanup done');
  } catch (err) {
    logger.error({ err: err.message }, '[behavioral.cleanup] Rate limit cleanup failed');
    summary.rateLimitCleanupError = err.message;
  }

  // 5. Behavioral security Redis keys
  try {
    const behavResult = await behavioralCleanup();
    summary.behavioralKeys = behavResult;
    logger.info(behavResult, '[behavioral.cleanup] Behavioral security cleanup done');
  } catch (err) {
    logger.error({ err: err.message }, '[behavioral.cleanup] Behavioral security cleanup failed');
    summary.behavioralCleanupError = err.message;
  }

  // 6. Orphaned idempotency keys
  try {
    const idemKeys = await scanKeys('orch:idem:*');
    let deletedIdem = 0;
    for (const key of idemKeys) {
      const ttl = await redis.ttl(key);
      if (ttl === -1) {
        await redis.del(key);
        deletedIdem++;
      }
    }
    summary.deletedIdemKeys = deletedIdem;
    logger.info({ count: deletedIdem }, '[behavioral.cleanup] Idempotency key cleanup done');
  } catch (err) {
    logger.error({ err: err.message }, '[behavioral.cleanup] Idempotency key cleanup failed');
    summary.idemCleanupError = err.message;
  }

  const durationMs = Date.now() - startTime;
  logger.info({ ...summary, durationMs }, '[behavioral.cleanup] Job completed');
  return { ...summary, durationMs };
};
