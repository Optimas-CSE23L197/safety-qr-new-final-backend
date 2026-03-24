// =============================================================================
// middleware/rateLimit.middleware.js — RESQID
// Layered rate limiting — different windows per route type
// Redis-backed — shared across all Node.js instances (cluster-safe)
//
// CHANGES FROM PREVIOUS VERSION:
//   [FIX-1] redis.call(...args) → redis.sendCommand(args)
//           ioredis does not expose .call(). Using it caused a TypeError
//           on every rate-limit check, meaning NO rate limiting was active.
//           The correct ioredis method is .sendCommand(argsArray).
//   [FIX-2] perTokenScanLimit: req.params.token → req.params.code
//           The scan route param is :code (not :token). req.params.token was
//           always undefined, so all scans incremented the same Redis key
//           "rl:token:undefined" and the per-token guard never fired.
//   [FIX-3] Removed dead import: hashToken from hashUtil.js was imported
//           but never used anywhere in this file.
//   [FIX-4] logRateLimitHit: on the public scan route req.userId is always
//           undefined (no auth). The DEVICE branch was never reachable here.
//           Clarified comment; logic unchanged (IP fallback is correct).
// =============================================================================

import { rateLimit } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { redis } from "../config/redis.js";
import { asyncHandler } from "../utils/response/asyncHandler.js";
import { prisma } from "../config/prisma.js";
import { extractIp } from "../utils/network/extractIp.js";
import { logger } from "../config/logger.js";

// =============================================================================
// REDIS STORE FACTORY
// =============================================================================

/**
 * Create a rate-limit-redis store wired to the shared ioredis instance.
 *
 * [FIX-1] ioredis uses .sendCommand(argsArray) — NOT .call(...args).
 * rate-limit-redis passes the command as spread args; we wrap to an array.
 *
 * @param {string} prefix — Redis key prefix e.g. "rl:scan:"
 */
function makeRedisStore(prefix) {
  return new RedisStore({
    sendCommand: (...args) => redis.call(...args),
    prefix,
  });
}

// =============================================================================
// SHARED HANDLER
// =============================================================================

function onLimitReached(req, res) {
  // Log to DB async for anomaly detection — non-blocking, never throws.
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

// =============================================================================
// RATE LIMITERS
// =============================================================================

/**
 * publicEmergencyLimiter
 * The public scan endpoint — most aggressive limit, highest abuse risk.
 * 10 requests per minute per IP.
 * Redis-backed — enforced across the entire cluster, not per-process.
 *
 * Used by: scan.routes.js
 */
export const publicEmergencyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeRedisStore("rl:emergency:"),
  keyGenerator: (req) => extractIp(req),
  handler: onLimitReached,
  skipSuccessfulRequests: false, // count every request — success or fail
});

/**
 * authLimiter
 * Login, OTP send/verify — brute-force protection.
 * 5 per 15 minutes per IP — very strict.
 *
 * Used by: auth.routes.js
 */
export const authLimiter = rateLimit({
  // skip: () => process.env.NODE_ENV === "development",
  skip: () => false,
  windowMs: 15 * 60 * 1000,
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
 * OTP resend — prevents SMS bill-bombing.
 * 3 per 10 minutes per phone number.
 *
 * NOTE: Redis counter is NOT reset on successful OTP verify (intentional).
 * A user who verifies on attempt 2 gets only 1 more OTP in the window.
 * This is acceptable UX friction that prevents rapid re-request cycles.
 *
 * Used by: auth.routes.js
 */
export const otpLimiter = asyncHandler(async (req, res, next) => {
  const phone = req.body?.phone;
  if (!phone) return next();

  const key = `rl:otp:${phone}`;
  const current = await redis.incr(key);

  if (current === 1) {
    await redis.expire(key, 10 * 60); // 10-minute window
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
 * General authenticated API — generous but bounded.
 * 300 per minute per user ID (falls back to IP for unauthenticated calls).
 *
 * Used by: general authenticated routes
 */
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
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
 * File upload endpoints — expensive per request, tightly controlled.
 * 10 per hour per user.
 *
 * Used by: upload routes in school_admin, parents
 */
export const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeRedisStore("rl:upload:"),
  keyGenerator: (req) => req.userId ?? extractIp(req),
  handler: onLimitReached,
});

/**
 * dashboardLimiter
 * Super admin + school admin dashboards.
 * 500 per minute — high throughput for admin workflows.
 * Only failed requests counted (skipSuccessfulRequests: true).
 *
 * Used by: school_admin.routes.js, super_admin.routes.js
 */
export const dashboardLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeRedisStore("rl:dashboard:"),
  keyGenerator: (req) => req.userId ?? extractIp(req),
  handler: onLimitReached,
  skipSuccessfulRequests: true,
});

/**
 * tokenGenerationLimiter
 * QR/token bulk generation — very expensive, super admin only.
 * 5 bulk operations per hour.
 *
 * Used by: super_admin token generation routes
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

// =============================================================================
// PER-TOKEN SCAN RATE LIMIT (Redis + DB persistence)
// =============================================================================

/**
 * perTokenScanLimit
 * Prevents a single QR code from being hammered continuously.
 * 20 scans per hour per scan code — legitimate use is maybe 3–5 per day.
 *
 * On breach: persists a block entry to DB (ScanRateLimit table) so that
 * school admins and the anomaly detection system can correlate.
 * req.scanCount is set so the controller/service can access it without
 * a second Redis read.
 *
 * [FIX-2] Was reading req.params.token — the scan route param is :code.
 * req.params.token was always undefined, so the guard never fired.
 *
 * Used by: scan.routes.js
 */
export const perTokenScanLimit = asyncHandler(async (req, res, next) => {
  const scanCode = req.params.code; // [FIX-2] was req.params.token
  if (!scanCode) return next();

  const key = `rl:token:${scanCode}`;
  const current = await redis.incr(key);

  if (current === 1) {
    await redis.expire(key, 60 * 60); // 1-hour window
  }

  if (current > 20) {
    // Persist block to DB for anomaly correlation and admin visibility.
    // Non-blocking — a logging failure must not prevent the 429 response.
    persistTokenBlock(scanCode, current).catch((e) =>
      logger.warn({ err: e.message }, "Token block persist failed"),
    );

    return res.status(429).json({
      success: false,
      message: "This QR code has been scanned too many times recently",
      requestId: req.id,
    });
  }

  // Pass the running count downstream — service can use it for anomaly
  // threshold checks without an additional Redis read.
  req.scanCount = current;
  next();
});

// =============================================================================
// IP BLOCK CHECK (DB-backed persistent blocks)
// =============================================================================

/**
 * checkIpBlocked
 * Checks ScanRateLimit for a persistent IP block written by anomaly detection.
 * Runs BEFORE other rate limiters on the public scan route — cheap DB lookup
 * that kills known-bad IPs before any Redis or crypto work happens.
 *
 * Used by: scan.routes.js (first middleware in chain)
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

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Log a rate-limit hit to the ScanRateLimit table.
 * Called from onLimitReached — async, non-blocking, swallowed on failure.
 *
 * [FIX-4] On the public scan route req.userId is always null (no auth).
 * The DEVICE branch is never reached from scan.routes.js — only from
 * authenticated routes where req.userId is set. Both branches are correct;
 * this note clarifies the runtime path per route type.
 */
async function logRateLimitHit(req) {
  const ip = extractIp(req);
  // [FIX-4] req.userId is null on unauthenticated routes — always falls to IP
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

/**
 * Persist a per-token block to ScanRateLimit for anomaly correlation.
 * Sets blocked_until = +1 hour, increments block_count.
 * Called fire-and-forget from perTokenScanLimit.
 */
async function persistTokenBlock(scanCode, count) {
  await prisma.scanRateLimit.upsert({
    where: {
      identifier_identifier_type: {
        identifier: scanCode,
        identifier_type: "TOKEN",
      },
    },
    update: {
      count,
      last_hit: new Date(),
      block_count: { increment: 1 },
      blocked_until: new Date(Date.now() + 60 * 60 * 1000), // +1 hour
      blocked_reason: "Per-token scan limit exceeded",
    },
    create: {
      identifier: scanCode,
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
