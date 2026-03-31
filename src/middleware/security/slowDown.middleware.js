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

/**
 * publicEmergencySlowDown — STRICT
 * After 3 requests in 1 min → add 1000ms delay per additional request
 * Max delay: 10 seconds — aggressive bot throttling
 * After 15 requests → block (handled by rate limiter)
 */
export const publicEmergencySlowDown = slowDown({
  windowMs: 60 * 1000,
  delayAfter: 3, // was 5 — stricter
  delayMs: hits => (hits - 3) * 1000, // was 500ms — now 1s per excess
  maxDelayMs: 10000, // was 3000ms — now 10s max
  store: makeStore('sd:emergency:'),
  keyGenerator: req => extractIp(req),
  skip: req => false,
  onLimitReached: (req, res, options) => {
    logger.warn(
      { ip: extractIp(req), hits: req.slowDown?.current },
      'STRICT: Emergency endpoint slowdown limit reached'
    );
  },
});

/**
 * authSlowDown — STRICT
 * After 2 failed attempts → progressive delay
 * 2 second delay per excess, max 30 seconds
 */
export const authSlowDown = slowDown({
  windowMs: 15 * 60 * 1000,
  delayAfter: 2, // was 3 — stricter
  delayMs: hits => (hits - 2) * 2000, // was 1000ms — now 2s per excess
  maxDelayMs: 30000, // was 10000ms — now 30s
  store: makeStore('sd:auth:'),
  keyGenerator: req => extractIp(req),
  onLimitReached: (req, res, options) => {
    logger.warn(
      { ip: extractIp(req), hits: req.slowDown?.current },
      'STRICT: Auth endpoint slowdown limit reached'
    );
  },
});

/**
 * apiSlowDown — STRICT
 * After 100 requests in 1 min → add 500ms delay per excess
 * Max delay: 5 seconds
 */
export const apiSlowDown = slowDown({
  windowMs: 60 * 1000,
  delayAfter: 100, // was 200 — stricter
  delayMs: hits => (hits - 100) * 500, // was 100ms — now 500ms per excess
  maxDelayMs: 5000, // was 2000ms — now 5s
  store: makeStore('sd:api:'),
  keyGenerator: req => req.userId ?? extractIp(req),
  onLimitReached: (req, res, options) => {
    logger.warn(
      { userId: req.userId, ip: extractIp(req), hits: req.slowDown?.current },
      'STRICT: API slowdown limit reached'
    );
  },
});

/**
 * scanTokenSlowDown — NEW
 * Per-token progressive slowdown for QR scan endpoint
 * After 5 scans per hour → add 2s delay per excess
 * Prevents brute-force enumeration of tokens
 */
export const scanTokenSlowDown = slowDown({
  windowMs: 60 * 60 * 1000, // 1 hour
  delayAfter: 5, // after 5 scans
  delayMs: hits => (hits - 5) * 2000, // 2s per excess
  maxDelayMs: 30000, // max 30s delay
  store: makeStore('sd:scan_token:'),
  keyGenerator: req => req.params?.code?.slice(0, 20) ?? req.ip,
  onLimitReached: (req, res, options) => {
    logger.warn(
      { code: req.params?.code?.slice(0, 8), hits: req.slowDown?.current },
      'STRICT: Scan token slowdown limit reached'
    );
  },
});

/**
 * ipSlowDown — NEW
 * IP-based progressive slowdown for all unauthenticated endpoints
 * After 50 requests in 5 min → add 500ms delay per excess
 */
export const ipSlowDown = slowDown({
  windowMs: 5 * 60 * 1000, // 5 minutes
  delayAfter: 50, // after 50 requests
  delayMs: hits => (hits - 50) * 500,
  maxDelayMs: 5000, // max 5s delay
  store: makeStore('sd:ip:'),
  keyGenerator: req => extractIp(req),
  onLimitReached: (req, res, options) => {
    logger.warn(
      { ip: extractIp(req), hits: req.slowDown?.current },
      'STRICT: IP slowdown limit reached'
    );
  },
});
