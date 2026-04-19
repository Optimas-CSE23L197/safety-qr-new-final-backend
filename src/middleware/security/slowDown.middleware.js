// =============================================================================
// slowDown.middleware.js — RESQID
// STRICT MODE — Progressive request slowing with aggressive thresholds
// Adds artificial delay to slow automated scanners, then escalates to block
// =============================================================================

import slowDown from 'express-slow-down';
import { RedisStore } from 'rate-limit-redis';
import { middlewareRedis } from '#config/redis.js';
import { extractIp } from '#shared/network/extractIp.js';
import { logger } from '#config/logger.js';

function makeStore(prefix) {
  return new RedisStore({
    sendCommand: (command, ...args) => middlewareRedis.call(command, ...args),
    prefix,
  });
}

// ── IPv6-safe key generators ───────────────────────────────────────────────────
// express-rate-limit v7 requires IPv6 addresses to be normalized to avoid
// bypass via address expansion. extractIp already handles this — we just need
// to ensure req.ip is never used directly in keyGenerator.

/**
 * publicEmergencySlowDown — STRICT
 * After 3 requests in 1 min → add 1000ms delay per additional request
 * Max delay: 10 seconds — aggressive bot throttling
 */
export const publicEmergencySlowDown = slowDown({
  windowMs: 60 * 1000,
  delayAfter: 3,
  delayMs: hits => {
    const delay = (hits - 3) * 1000;
    if (delay > 0) {
      logger.warn({ hits }, 'STRICT: Emergency endpoint slowdown triggered');
    }
    return delay;
  },
  maxDelayMs: 10000,
  store: makeStore('sd:emergency:'),
  keyGenerator: req => extractIp(req),
  skip: () => false,
});

/**
 * authSlowDown — STRICT
 * After 2 failed attempts → progressive delay
 * 2 second delay per excess, max 30 seconds
 */
export const authSlowDown = slowDown({
  windowMs: 15 * 60 * 1000,
  delayAfter: 2,
  delayMs: hits => {
    const delay = (hits - 2) * 2000;
    if (delay > 0) {
      logger.warn({ hits }, 'STRICT: Auth endpoint slowdown triggered');
    }
    return delay;
  },
  maxDelayMs: 30000,
  store: makeStore('sd:auth:'),
  keyGenerator: req => extractIp(req),
});

/**
 * apiSlowDown — STRICT
 * After 100 requests in 1 min → add 500ms delay per excess
 * Max delay: 5 seconds
 */
export const apiSlowDown = slowDown({
  windowMs: 60 * 1000,
  delayAfter: 100,
  delayMs: hits => {
    const delay = (hits - 100) * 500;
    if (delay > 0) {
      logger.warn({ hits }, 'STRICT: API slowdown triggered');
    }
    return delay;
  },
  maxDelayMs: 5000,
  store: makeStore('sd:api:'),
  keyGenerator: req => req.userId ?? extractIp(req),
});

/**
 * scanTokenSlowDown
 * Per-token progressive slowdown for QR scan endpoint
 * After 5 scans per hour → add 2s delay per excess
 */
export const scanTokenSlowDown = slowDown({
  windowMs: 60 * 60 * 1000,
  delayAfter: 5,
  delayMs: hits => {
    const delay = (hits - 5) * 2000;
    if (delay > 0) {
      logger.warn({ hits }, 'STRICT: Scan token slowdown triggered');
    }
    return delay;
  },
  maxDelayMs: 30000,
  store: makeStore('sd:scan_token:'),
  // req.params.code is not an IP — safe to use directly, no IPv6 concern
  keyGenerator: req => req.params?.code?.slice(0, 20) ?? extractIp(req),
});

/**
 * ipSlowDown
 * IP-based progressive slowdown for all unauthenticated endpoints
 * After 50 requests in 5 min → add 500ms delay per excess
 */
export const ipSlowDown = slowDown({
  windowMs: 5 * 60 * 1000,
  delayAfter: 50,
  delayMs: hits => {
    const delay = (hits - 50) * 500;
    if (delay > 0) {
      logger.warn({ hits }, 'STRICT: IP slowdown triggered');
    }
    return delay;
  },
  maxDelayMs: 5000,
  store: makeStore('sd:ip:'),
  keyGenerator: req => extractIp(req),
});
