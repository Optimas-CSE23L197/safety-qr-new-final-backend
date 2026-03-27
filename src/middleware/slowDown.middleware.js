// =============================================================================
// slowDown.middleware.js — RESQID
// Progressive request slowing — layer before hard rate limit
// Adds artificial delay to slow automated scanners without hard-blocking
// =============================================================================

import slowDown from 'express-slow-down';
import { RedisStore } from 'rate-limit-redis';
// ✅ FIX: was `redis` (enableOfflineQueue: false) — crashes at startup because
// RedisStore runs EVAL in its constructor before the connection is ready.
// middlewareRedis has enableOfflineQueue: true so the Lua script queues safely.
import { middlewareRedis } from '#config/database/redis.js';
import { extractIp } from '#utils/network/extractIp.js';

function makeStore(prefix) {
  return new RedisStore({
    // ✅ FIX: was `redis.call(...args)` — two bugs:
    //   a) wrong client (redis instead of middlewareRedis)
    //   b) wrong method shape — rate-limit-redis v4 calls sendCommand(command, ...args)
    //      ioredis exposes this via .call(command, ...args)
    sendCommand: (command, ...args) => middlewareRedis.call(command, ...args),
    prefix,
  });
}

/**
 * publicEmergencySlowDown
 * After 5 requests in 1 min → add 500ms delay per additional request
 * Max delay: 3 seconds — enough to frustrate bots, fine for humans
 * Runs BEFORE publicEmergencyLimiter
 */
export const publicEmergencySlowDown = slowDown({
  windowMs: 60 * 1000,
  delayAfter: 5,
  delayMs: hits => (hits - 5) * 500,
  maxDelayMs: 3000,
  store: makeStore('sd:emergency:'),
  keyGenerator: req => extractIp(req),
  skip: req => false,
});

/**
 * authSlowDown
 * After 3 failed attempts → progressive delay
 * Works WITH authLimiter for layered brute-force protection
 */
export const authSlowDown = slowDown({
  windowMs: 15 * 60 * 1000,
  delayAfter: 3,
  delayMs: hits => (hits - 3) * 1000,
  maxDelayMs: 10_000,
  store: makeStore('sd:auth:'),
  keyGenerator: req => extractIp(req),
});

/**
 * apiSlowDown
 * General API — only kicks in at very high volume
 * Protects against sudden traffic spikes from a single user
 */
export const apiSlowDown = slowDown({
  windowMs: 60 * 1000,
  delayAfter: 200,
  delayMs: hits => (hits - 200) * 100,
  maxDelayMs: 2000,
  store: makeStore('sd:api:'),
  keyGenerator: req => req.userId ?? extractIp(req),
});
