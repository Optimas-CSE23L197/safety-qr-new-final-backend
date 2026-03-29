// =============================================================================
// orchestrator/jobs/behavioral.cleanup.job.js — RESQID
// Nightly cleanup cron — runs at 2 AM IST every night.
// Cleans: expired OTPs, rate limit records, expired sessions,
//         blacklisted tokens, behavioral security Redis keys.
//
// DOES NOT delete OrderStatusLog or AuditLog — those are compliance records.
// =============================================================================

import { prisma } from '#config/prisma.js';
import { redis } from '#config/redis.js';
import { logger } from '#config/logger.js';
import { behavioralCleanup } from '#middleware/security/behavioralSecurity.middleware.js';

/**
 * Run all nightly cleanup tasks.
 * Called by scheduler.js — not a cron by itself, scheduler owns the schedule.
 *
 * @returns {Promise<object>} cleanup summary
 */
export const runBehavioralCleanup = async () => {
  const startTime = Date.now();
  const summary = {};

  logger.info({ job: 'behavioral_cleanup' }, '[behavioral.cleanup] Job started');

  // ── 1. Expired OTPs ──────────────────────────────────────────────────────
  // NOTE: redis.keys() is O(N) and blocks the Redis event loop.
  // Safe at current scale (< 1k keys). If key count grows past ~10k,
  // replace with a cursor-based redis.scan() loop.
  try {
    const otpKeys = await redis.keys('otp:*');
    let deletedOtps = 0;
    for (const key of otpKeys) {
      const ttl = await redis.ttl(key);
      if (ttl === -1) {
        // no expiry — should not happen, but clean up defensively
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

  // ── 2. Expired sessions (DB) ─────────────────────────────────────────────
  try {
    const result = await prisma.session.deleteMany({
      where: {
        OR: [{ expires_at: { lt: new Date() } }, { is_revoked: true }],
      },
    });
    summary.deletedSessions = result.count;
    logger.info({ count: result.count }, '[behavioral.cleanup] Session cleanup done');
  } catch (err) {
    logger.error({ err: err.message }, '[behavioral.cleanup] Session cleanup failed');
    summary.sessionCleanupError = err.message;
  }

  // ── 3. Expired blacklisted tokens (DB) ───────────────────────────────────
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

  // ── 4. Expired rate limit records (DB) ────────────────────────────────────
  try {
    const result = await prisma.scanRateLimit.deleteMany({
      where: {
        blocked_until: { lt: new Date() },
        blocked_reason: { not: null },
      },
    });
    summary.deletedRateLimitRecords = result.count;
    logger.info({ count: result.count }, '[behavioral.cleanup] Rate limit cleanup done');
  } catch (err) {
    logger.error({ err: err.message }, '[behavioral.cleanup] Rate limit cleanup failed');
    summary.rateLimitCleanupError = err.message;
  }

  // ── 5. Behavioral security Redis keys (via existing middleware function) ──
  try {
    const behavResult = await behavioralCleanup();
    summary.behavioralKeys = behavResult;
    logger.info(behavResult, '[behavioral.cleanup] Behavioral security cleanup done');
  } catch (err) {
    logger.error({ err: err.message }, '[behavioral.cleanup] Behavioral security cleanup failed');
    summary.behavioralCleanupError = err.message;
  }

  // ── 6. Orphaned Redis idempotency keys with no TTL ────────────────────────
  // NOTE: Same redis.keys() caveat as step 1 — replace with scan() if
  // orch:idem:* key count exceeds ~10k.
  try {
    const idemKeys = await redis.keys('orch:idem:*');
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
  logger.info(
    { job: 'behavioral_cleanup', ...summary, durationMs },
    '[behavioral.cleanup] Job completed'
  );

  return { ...summary, durationMs };
};
