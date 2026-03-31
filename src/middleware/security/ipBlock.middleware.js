// =============================================================================
// ipBlock.middleware.js — RESQID
// NO MERCY MODE — Strict IP blocking with zero tolerance
// Blocks IPs flagged by attackLogger, geoBlock, or behavioralSecurity
//
// Two-layer check:
//   1. Redis  — O(1), checked first on every request (cached blocks)
//   2. DB     — checked on Redis miss only (first request after block set)
//
// Block triggers:
//   a) ANY attack attempt — IMMEDIATE block (no threshold)
//   b) Manual block from admin
//   c) Geo-block violation
//   d) Behavioral score >= 30 (suspicious activity)
//
// Block duration: Escalating based on repeat offenses
//   - First offense: 24 hours
//   - Second offense: 7 days
//   - Third offense: 30 days
//   - Fourth offense: Permanent (1 year)
// =============================================================================

import { redis } from '#config/redis.js';
import { prisma } from '#config/prisma.js';
import { ApiError } from '#shared/response/ApiError.js';
import { asyncHandler } from '#shared/response/asyncHandler.js';
import { logger } from '#config/logger.js';

// ─── Config — NO MERCY ────────────────────────────────────────────────────────

const BLOCK_THRESHOLD = 1; // ANY attack = block immediately (was 5)
const BLOCK_DURATIONS = {
  1: 24 * 60 * 60, // 1st offense: 24 hours
  2: 7 * 24 * 60 * 60, // 2nd offense: 7 days
  3: 30 * 24 * 60 * 60, // 3rd offense: 30 days
  4: 365 * 24 * 60 * 60, // 4th offense: 1 year (permanent)
};

const MAX_BLOCK_DURATION = BLOCK_DURATIONS[4];

// IPs that should NEVER be blocked — loopback only, no private ranges allowed
const NEVER_BLOCK = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];

const redisKey = ip => `blocked:ip:${ip}`;
const offenseKey = ip => `blocked:offense:${ip}`;

// ─── Helper: Get offense count ───────────────────────────────────────────────

async function getOffenseCount(ip) {
  const count = await redis.get(offenseKey(ip));
  return count ? parseInt(count, 10) : 0;
}

async function incrementOffenseCount(ip) {
  const count = await redis.incr(offenseKey(ip));
  if (count === 1) await redis.expire(offenseKey(ip), MAX_BLOCK_DURATION);
  return count;
}

// ─── Helper: Get block duration based on offense count ───────────────────────

function getBlockDuration(offenseCount) {
  return BLOCK_DURATIONS[Math.min(offenseCount, 4)] || BLOCK_DURATIONS[4];
}

// ─── Middleware ───────────────────────────────────────────────────────────────

export const ipBlockMiddleware = asyncHandler(async (req, _res, next) => {
  const ip = req.ip ?? 'unknown';

  // NEVER block localhost — only loopback, no exceptions
  if (ip === 'unknown' || NEVER_BLOCK.includes(ip)) return next();

  // ── Fast path — Redis ────────────────────────────────────────────────────────
  try {
    const cached = await redis.get(redisKey(ip));
    if (cached) {
      const blockData = JSON.parse(cached);
      const remainingHours = Math.ceil(blockData.ttl / 3600);

      logger.warn(
        {
          type: 'ip_blocked_redis',
          ip,
          path: req.path,
          requestId: req.id,
          offenseCount: blockData.offenseCount,
          expiresIn: `${remainingHours}h`,
        },
        `🚫 BLOCKED IP (${blockData.offenseCount} offenses): ${ip}`
      );
      throw ApiError.forbidden('Access denied. IP has been blocked.');
    }
  } catch (err) {
    if (err.status === 403) throw err;
    // Redis down — log and continue (fail open for emergency)
    logger.error({ err, type: 'redis_block_check_failed' }, 'Redis block check failed — passing');
  }

  // ── Slow path — DB (cache miss) ─────────────────────────────────────────────
  const record = await prisma.scanRateLimit.findUnique({
    where: {
      identifier_identifier_type: {
        identifier: ip,
        identifier_type: 'IP',
      },
    },
    select: {
      block_count: true,
      blocked_until: true,
      blocked_reason: true,
    },
  });

  if (record) {
    const isHardBlocked = record.blocked_until && record.blocked_until > new Date();
    const isThresholdBlock = record.block_count >= BLOCK_THRESHOLD;

    if (isHardBlocked || isThresholdBlock) {
      // Get offense count from Redis or DB
      let offenseCount = await getOffenseCount(ip);
      if (offenseCount === 0 && record.block_count > 0) {
        offenseCount = Math.min(record.block_count, 4);
        await redis.setex(offenseKey(ip), MAX_BLOCK_DURATION, offenseCount);
      }

      const blockDuration = getBlockDuration(offenseCount || 1);

      // Cache in Redis with metadata
      await redis
        .setex(
          redisKey(ip),
          blockDuration,
          JSON.stringify({
            offenseCount: offenseCount || 1,
            blockedAt: new Date().toISOString(),
            ttl: blockDuration,
            reason: record.blocked_reason,
          })
        )
        .catch(() => {});

      logger.warn(
        {
          type: 'ip_blocked_db',
          ip,
          block_count: record.block_count,
          offenseCount: offenseCount || 1,
          blocked_until: record.blocked_until,
          reason: record.blocked_reason,
          path: req.path,
          requestId: req.id,
        },
        `🚫 BLOCKED IP (${offenseCount || 1} offenses): ${ip}`
      );

      throw ApiError.forbidden('Access denied. IP has been blocked.');
    }
  }

  next();
});

// ─── Manual Block Helper — NO MERCY ──────────────────────────────────────────

/**
 * blockIpNow(ip, reason)
 * Instantly hard-blocks an IP with escalating duration.
 * No threshold — immediate permanent record.
 *
 * @param {string} ip
 * @param {string} reason — stored in ScanRateLimit.blocked_reason
 */
export async function blockIpNow(ip, reason = 'MANUAL_BLOCK') {
  if (!ip || NEVER_BLOCK.includes(ip)) return;

  // Increment offense count
  const offenseCount = await incrementOffenseCount(ip);
  const blockDuration = getBlockDuration(offenseCount);
  const blockedUntil = new Date(Date.now() + blockDuration * 1000);

  await Promise.all([
    // Redis — immediate block with metadata
    redis.setex(
      redisKey(ip),
      blockDuration,
      JSON.stringify({
        offenseCount,
        blockedAt: new Date().toISOString(),
        ttl: blockDuration,
        reason,
      })
    ),

    // DB — persistent record
    prisma.scanRateLimit.upsert({
      where: {
        identifier_identifier_type: {
          identifier: ip,
          identifier_type: 'IP',
        },
      },
      create: {
        identifier: ip,
        identifier_type: 'IP',
        count: 1,
        block_count: offenseCount,
        blocked_until: blockedUntil,
        blocked_reason: `${reason}_OFFENSE_${offenseCount}`,
        last_hit: new Date(),
        window_start: new Date(),
      },
      update: {
        block_count: offenseCount,
        blocked_until: blockedUntil,
        blocked_reason: `${reason}_OFFENSE_${offenseCount}`,
        last_hit: new Date(),
      },
    }),
  ]);

  const durationText =
    blockDuration >= 86400
      ? `${Math.floor(blockDuration / 86400)} days`
      : `${Math.floor(blockDuration / 3600)} hours`;

  logger.warn(
    {
      ip,
      reason,
      offenseCount,
      blockDuration: durationText,
      blockedUntil,
      type: 'ip_blocked_manual',
    },
    `🔒 IP PERMANENTLY BLOCKED: ${ip} (offense #${offenseCount} — ${durationText})`
  );
}

// ─── Check if IP is blocked (for other middleware) ───────────────────────────

export async function isIpBlocked(ip) {
  if (NEVER_BLOCK.includes(ip)) return false;
  const cached = await redis.get(redisKey(ip));
  return cached !== null;
}
