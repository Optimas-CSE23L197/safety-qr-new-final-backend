// =============================================================================
// ipBlock.middleware.js — RESQID
// Blocks IPs flagged by attackLogger or geoBlock middlewares.
//
// Two-layer check:
//   1. Redis  — O(1), checked first on every request (cached blocks)
//   2. DB     — checked on Redis miss only (first request after block set)
//
// An IP is blocked when:
//   a) block_count >= BLOCK_THRESHOLD (5 attack attempts) — auto-block
//   b) blocked_until is set and in the future — manual or geo block
//   c) Redis key exists — cached from a previous DB hit
//
// blockIpNow() — exported helper to instantly hard-block any IP
// Used by: geoBlock.middleware.js (non-Indian IPs on dashboard routes)
//          Super admin dashboard (manual IP ban endpoint)
// =============================================================================

import { redis } from "../config/redis.js";
import { prisma } from "../config/prisma.js";
import { ApiError } from "../utils/response/ApiError.js";
import { asyncHandler } from "../utils/response/asyncHandler.js";
import { logger } from "../config/logger.js";

// ─── Config ───────────────────────────────────────────────────────────────────

const BLOCK_THRESHOLD = 5; // auto-block after N attacks
const BLOCK_TTL_SECONDS = 24 * 60 * 60; // Redis TTL — 24 hours
const BLOCK_DURATION_MS = BLOCK_TTL_SECONDS * 1000;

// IPs that should never be blocked — loopback + private ranges
const NEVER_BLOCK = ["127.0.0.1", "::1", "::ffff:127.0.0.1"];

const redisKey = (ip) => `blocked:ip:${ip}`;

// ─── Middleware ───────────────────────────────────────────────────────────────

export const ipBlockMiddleware = asyncHandler(async (req, _res, next) => {
  const ip = req.ip ?? "unknown";

  // Never block loopback or unknown — would break health checks + dev
  if (ip === "unknown" || NEVER_BLOCK.includes(ip)) return next();

  // ── Fast path — Redis ────────────────────────────────────────────────────────
  try {
    const cached = await redis.get(redisKey(ip));
    if (cached) {
      logger.warn(
        {
          type: "ip_blocked_redis",
          ip,
          path: req.path,
          requestId: req.id,
        },
        `🚫 Blocked IP rejected (Redis): ${ip}`,
      );
      throw ApiError.forbidden("Access denied");
    }
  } catch (err) {
    if (err.status === 403) throw err; // rethrow our own ApiError
    // Redis down — log and continue, don't block legitimate traffic
    logger.error(
      { err, type: "redis_block_check_failed" },
      "Redis block check failed — skipping",
    );
  }

  // ── Slow path — DB (cache miss) ───────────────────────────────────────────
  const record = await prisma.scanRateLimit.findUnique({
    where: {
      identifier_identifier_type: {
        identifier: ip,
        identifier_type: "IP",
      },
    },
    select: {
      block_count: true,
      blocked_until: true,
      blocked_reason: true,
    },
  });

  if (record) {
    const isHardBlocked =
      record.blocked_until && record.blocked_until > new Date();
    const isThresholdBlock = record.block_count >= BLOCK_THRESHOLD;

    if (isHardBlocked || isThresholdBlock) {
      // Cache in Redis — all subsequent requests hit fast path
      await redis.setex(redisKey(ip), BLOCK_TTL_SECONDS, "1").catch(() => {});

      logger.warn(
        {
          type: "ip_blocked_db",
          ip,
          block_count: record.block_count,
          blocked_until: record.blocked_until,
          reason: record.blocked_reason,
          path: req.path,
          requestId: req.id,
        },
        `🚫 Blocked IP rejected (DB): ${ip}`,
      );

      throw ApiError.forbidden("Access denied");
    }
  }

  next();
});

// ─── Manual Block Helper ──────────────────────────────────────────────────────

/**
 * blockIpNow(ip, reason)
 * Instantly hard-blocks an IP for 24 hours.
 * Writes to both Redis (immediate) and DB (persistent).
 *
 * Used by:
 *   - geoBlock.middleware.js (non-Indian IPs on dashboard routes)
 *   - Super admin manual ban endpoint
 *
 * @param {string} ip
 * @param {string} reason — stored in ScanRateLimit.blocked_reason
 */
export async function blockIpNow(ip, reason = "MANUAL_BLOCK") {
  if (!ip || NEVER_BLOCK.includes(ip)) return;

  const blockedUntil = new Date(Date.now() + BLOCK_DURATION_MS);

  await Promise.all([
    // Redis — takes effect immediately on next request
    redis.setex(redisKey(ip), BLOCK_TTL_SECONDS, "1"),

    // DB — persistent record, survives Redis flush, queryable from dashboard
    prisma.scanRateLimit.upsert({
      where: {
        identifier_identifier_type: {
          identifier: ip,
          identifier_type: "IP",
        },
      },
      create: {
        identifier: ip,
        identifier_type: "IP",
        count: 1,
        block_count: 1,
        blocked_until: blockedUntil,
        blocked_reason: reason,
        last_hit: new Date(),
        window_start: new Date(),
      },
      update: {
        block_count: { increment: 1 },
        blocked_until: blockedUntil,
        blocked_reason: reason,
        last_hit: new Date(),
      },
    }),
  ]);

  logger.warn(
    { ip, reason, blockedUntil, type: "ip_blocked_manual" },
    `🚫 IP hard-blocked: ${ip}`,
  );
}
