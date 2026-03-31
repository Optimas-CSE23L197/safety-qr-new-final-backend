// =============================================================================
// scan/middleware/scan.security.js — RESQID
//
// All security middleware for the public scan endpoint.
// Every check here runs before the controller touches crypto or DB.
//
// MIDDLEWARE CHAIN (in execution order in scan.routes.js):
//   1. checkIpBlockedRedis   — O(1) Redis check, kills known-bad IPs
//   2. publicScanLimiter     — 30 req/min per IP (Redis sliding window)
//   3. validate(scanCodeSchema) — Zod, rejects bad format before anything else
//   4. perTokenScanLimit     — 20 scans/hr per token (Redis counter)
//
// DESIGN PRINCIPLES:
//   - Cheapest check first: Redis before Zod before DB
//   - Never leak rate limit headers (no X-RateLimit-Remaining)
//   - All limiters are cluster-safe (Redis-backed, not in-memory)
//   - Middleware never logs PII — IP is the only identifier used
// =============================================================================

import { RateLimiterRedis } from 'rate-limiter-flexible';
import { redis } from '#config/redis.js';
import { logger } from '#config/logger.js';
import { isIpBlocked } from '#shared/cache/scan.cache.js';
import { extractIp } from '#shared/network/extractIp.js';

// ── Limiter instances ─────────────────────────────────────────────────────────
// Created once at module load — not per-request.

/**
 * Per-IP sliding window: 30 requests per 60 seconds.
 * Covers burst abuse — a real emergency scan never fires 30 times/min.
 */
const ipLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'rl:scan:ip',
  points: 30,
  duration: 60,
  blockDuration: 60, // auto-block for 60s on overflow
});

/**
 * Per-token sliding window: 20 scans per hour.
 * A real card gets scanned maybe 5–10 times a year.
 * 20/hr gives generous room for edge cases while catching scrapers.
 */
const tokenLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'rl:scan:token',
  points: 20,
  duration: 3600,
  blockDuration: 3600, // block token for 1hr on overflow
});

// ── Static error response ─────────────────────────────────────────────────────

// SECURITY: Never send X-RateLimit-Remaining or X-RateLimit-Reset headers.
// These tell an attacker exactly when to resume scanning.
const blockedResponse = (res, message = 'Too many requests.') =>
  res.status(429).json({ success: false, message });

// ── Middleware ────────────────────────────────────────────────────────────────

/**
 * Layer 1 — IP block check (Redis O(1)).
 * Must be the FIRST middleware in the chain.
 * Checks Redis blocklist only — never touches Postgres on the hot path.
 * DB blocklist is synced to Redis on startup and on new block creation.
 */
export const checkIpBlockedRedis = async (req, res, next) => {
  const ip = extractIp(req);
  try {
    const blocked = await isIpBlocked(ip);
    if (blocked) {
      logger.info({ ip }, '[scan.security] Blocked IP rejected');
      // Return same 429 as rate limit — don't reveal WHY they're blocked
      return blockedResponse(res);
    }
    next();
  } catch (err) {
    // Redis failure — fail open. Never block a legit emergency scan.
    logger.error({ err: err.message, ip }, '[scan.security] checkIpBlockedRedis error — passing');
    next();
  }
};

/**
 * Layer 2 — Per-IP rate limit: 30 req/60s.
 * Uses rate-limiter-flexible with Redis backend — cluster-safe.
 */
export const publicScanLimiter = async (req, res, next) => {
  const ip = extractIp(req);
  try {
    await ipLimiter.consume(ip);
    next();
  } catch (err) {
    if (err.msBeforeNext !== undefined) {
      // RateLimiterRes — expected limit exceeded
      logger.info({ ip }, '[scan.security] IP rate limit exceeded');
      return blockedResponse(res);
    }
    // Unexpected Redis error — fail open
    logger.error({ err: err.message, ip }, '[scan.security] publicScanLimiter error — passing');
    next();
  }
};

/**
 * Layer 4 — Per-token rate limit: 20 scans/hr.
 * Runs AFTER validate() so we only process valid base62 codes.
 * Attaches req.scanCount for the service layer (avoids a redundant Redis read).
 */
export const perTokenScanLimit = async (req, res, next) => {
  const { code } = req.params;
  try {
    const result = await tokenLimiter.consume(code);
    // Remaining points = max - consumed so far
    req.scanCount = tokenLimiter.points - result.remainingPoints;
    next();
  } catch (err) {
    if (err.msBeforeNext !== undefined) {
      logger.info({ code: code.slice(0, 8) }, '[scan.security] Token rate limit exceeded');
      return blockedResponse(res, 'This QR code has been scanned too many times recently.');
    }
    logger.error({ err: err.message }, '[scan.security] perTokenScanLimit error — passing');
    req.scanCount = 1;
    next();
  }
};
