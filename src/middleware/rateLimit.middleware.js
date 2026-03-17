// =============================================================================
// rateLimit.middleware.js — RESQID
// Layered rate limiting — different windows per route type
// Public emergency API has the most aggressive limits (prime abuse target)
// Redis-backed — shared across all Node.js instances (cluster-safe)
// =============================================================================

import { rateLimit } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { redis } from "../config/redis.js";
import { ApiError } from "../utils/response/ApiError.js";
import { asyncHandler } from "../utils/response/asyncHandler.js";
import { prisma } from "../config/prisma.js";
import { extractIp } from "../utils/network/extractIp.js";
import { ENV } from "../config/env.js";
import { hashToken } from "../utils/security/hashUtil.js";

// FIX [#1]: logger was referenced in onLimitReached and persistTokenBlock but
// never imported — caused a ReferenceError at runtime on any rate-limit hit.
import { logger } from "../config/logger.js";

// ─── Redis Store Factory ──────────────────────────────────────────────────────

function makeRedisStore(prefix) {
  return new RedisStore({
    sendCommand: (...args) => redis.call(...args),
    prefix,
  });
}

// ─── Shared Handler ───────────────────────────────────────────────────────────

function onLimitReached(req, res) {
  // Log to DB async for anomaly detection — non-blocking
  logRateLimitHit(req).catch((e) =>
    logger.warn({ err: e.message }, "Rate limit hit logging failed"),
  );

  res.status(429).json({
    success: false,
    message: "Too many requests — please slow down",
    requestId: req.id,
    retryAfter: Math.ceil(res.getHeader("Retry-After") ?? 60),
  });
}

// ─── Rate Limit Configs ───────────────────────────────────────────────────────

/**
 * publicEmergencyLimiter
 * Most aggressive — this is the public API that anyone can hit
 * 10 requests per minute per IP — enough for genuine emergency use
 * Burst of 3 before slow-down kicks in (see slowDown.middleware.js)
 */
export const publicEmergencyLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeRedisStore("rl:emergency:"),
  keyGenerator: (req) => extractIp(req),
  handler: onLimitReached,
  skipSuccessfulRequests: false, // count ALL requests — success or fail
});

/**
 * authLimiter
 * Login, OTP send/verify — protect against brute force
 * 5 per 15 min per IP — very strict
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeRedisStore("rl:auth:"),
  keyGenerator: (req) => extractIp(req),
  handler: onLimitReached,
  skipSuccessfulRequests: false,
});

/**
 * otpLimiter
 * OTP resend specifically — prevent SMS bill bombing
 * 3 per 10 minutes per phone number
 *
 * NOTE [#7]: The Redis counter is NOT reset on a successful OTP verify.
 * This is intentional — a user who verifies on attempt 2 still gets only
 * 1 more OTP in the same 10-minute window. This is acceptable UX friction
 * that prevents rapid re-request cycles even after success. If this becomes
 * a support issue, add a redis.del(key) call in the OTP verify handler.
 */
export const otpLimiter = asyncHandler(async (req, res, next) => {
  const phone = req.body?.phone;
  if (!phone) return next();

  const key = `rl:otp:${phone}`;
  const current = await redis.incr(key);

  if (current === 1) {
    await redis.expire(key, 10 * 60); // 10 minute window
  }

  if (current > 3) {
    const ttl = await redis.ttl(key);
    return res.status(429).json({
      success: false,
      message: "Too many OTP requests for this number",
      retryAfter: ttl,
      requestId: req.id,
    });
  }

  res.setHeader("X-OTP-Remaining", Math.max(0, 3 - current));
  next();
});

/**
 * apiLimiter
 * General authenticated API — generous but still bounded
 * 300 per minute per user (not IP — authenticated users identified by ID)
 */
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeRedisStore("rl:api:"),
  keyGenerator: (req) => req.userId ?? extractIp(req),
  handler: onLimitReached,
  skipSuccessfulRequests: false,
});

/**
 * uploadLimiter
 * File upload endpoints — expensive, tightly controlled
 * 10 per hour per user
 */
export const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeRedisStore("rl:upload:"),
  keyGenerator: (req) => req.userId ?? extractIp(req),
  handler: onLimitReached,
});

/**
 * dashboardLimiter
 * Super admin + school admin dashboard
 * 500 per minute — high throughput for admin workflows
 */
export const dashboardLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeRedisStore("rl:dashboard:"),
  keyGenerator: (req) => req.userId ?? extractIp(req),
  handler: onLimitReached,
  skipSuccessfulRequests: true, // only count failed requests for dashboard
});

/**
 * tokenGenerationLimiter
 * Token/QR generation — very expensive operation, super admin only
 * 5 bulk operations per hour
 */
export const tokenGenerationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeRedisStore("rl:token-gen:"),
  keyGenerator: (req) => req.userId ?? extractIp(req),
  handler: onLimitReached,
});

// ─── Per-Token Scan Rate Limit (DB-backed for persistence) ───────────────────

/**
 * perTokenScanLimit
 * Prevents a single QR code from being hammered
 * 20 scans per hour per token — legitimate use is maybe 3-5 per day
 * Persists to DB for anomaly detection correlation
 */
export const perTokenScanLimit = asyncHandler(async (req, res, next) => {
  const tokenHash = req.params.token;
  if (!tokenHash) return next();

  const key = `rl:token:${tokenHash}`;
  const current = await redis.incr(key);

  if (current === 1) {
    await redis.expire(key, 60 * 60); // 1 hour window
  }

  if (current > 20) {
    // Persist block to DB for anomaly correlation
    await persistTokenBlock(tokenHash, current).catch((e) =>
      logger.warn({ err: e.message }, "Token block persist failed"),
    );

    return res.status(429).json({
      success: false,
      message: "This QR code has been scanned too many times recently",
      requestId: req.id,
    });
  }

  req.scanCount = current;
  next();
});

// ─── IP Block Check ───────────────────────────────────────────────────────────

/**
 * checkIpBlocked
 * Checks DB ScanRateLimit for persistent IP blocks
 * Runs before other rate limiters on public API
 */
export const checkIpBlocked = asyncHandler(async (req, res, next) => {
  const ip = extractIp(req);

  const block = await prisma.scanRateLimit.findUnique({
    where: {
      identifier_identifier_type: {
        identifier: ip,
        identifier_type: "IP",
      },
    },
    select: { blocked_until: true, blocked_reason: true },
  });

  if (block?.blocked_until && new Date(block.blocked_until) > new Date()) {
    return res.status(403).json({
      success: false,
      message: "IP address is temporarily blocked",
      requestId: req.id,
    });
  }

  next();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function logRateLimitHit(req) {
  const ip = extractIp(req);
  const identifierType = req.userId ? "DEVICE" : "IP";
  const identifier = req.userId ?? ip;

  await prisma.scanRateLimit.upsert({
    where: {
      identifier_identifier_type: {
        identifier,
        identifier_type: identifierType,
      },
    },
    update: {
      count: { increment: 1 },
      last_hit: new Date(),
    },
    create: {
      identifier,
      identifier_type: identifierType,
      count: 1,
      window_start: new Date(),
      last_hit: new Date(),
    },
  });
}

async function persistTokenBlock(tokenHash, count) {
  await prisma.scanRateLimit.upsert({
    where: {
      identifier_identifier_type: {
        identifier: tokenHash,
        identifier_type: "TOKEN",
      },
    },
    update: {
      count: count,
      last_hit: new Date(),
      block_count: { increment: 1 },
      blocked_until: new Date(Date.now() + 60 * 60 * 1000),
      blocked_reason: "Per-token scan limit exceeded",
    },
    create: {
      identifier: tokenHash,
      identifier_type: "TOKEN",
      count,
      window_start: new Date(),
      last_hit: new Date(),
      block_count: 1,
      blocked_until: new Date(Date.now() + 60 * 60 * 1000),
      blocked_reason: "Per-token scan limit exceeded",
    },
  });
}
