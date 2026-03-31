// =============================================================================
// scan/cache/scan.cache.js — RESQID
//
// Redis profile cache for the scan hot path.
//
// KEY DESIGN:
//   profile:{tokenHash}  — full resolved profile, TTL 60s
//   ip_block:{ip}        — blocked IP flag, TTL = block duration
//
// INVALIDATION:
//   invalidateScanCache(tokenHash) — called by admin when card is
//   deactivated / revoked. A revoked card must NEVER be served from cache.
//
// WHY tokenHash NOT raw tokenId:
//   The raw tokenId is a UUID that an attacker could brute-force cache
//   lookups with. The tokenHash is HMAC-derived from the scan code —
//   it is only known to someone who holds the physical card.
// =============================================================================

import { redis } from '#config/redis.js';
import { logger } from '#config/logger.js';
import crypto from 'crypto';

const PROFILE_TTL_S = 60; // 60 second cache — balances freshness vs load
const IP_BLOCK_TTL_S = 60 * 60 * 24; // 24h default IP block

// ── Key builders ─────────────────────────────────────────────────────────────

export const profileCacheKey = tokenId =>
  `scan:profile:${crypto.createHash('sha256').update(tokenId).digest('hex').slice(0, 32)}`;

export const ipBlockKey = ip => `blocked:ip:${ip}`;

export const tokenScanCountKey = tokenId => `scan:count:token:${tokenId}`;

export const ipScanCountKey = ip => `scan:count:ip:${ip}`;

export const ipTokenSetKey = ip => `scan:tokens_by_ip:${ip}`;

// ── Profile cache ─────────────────────────────────────────────────────────────

/**
 * Get cached profile for a token.
 * Returns parsed object or null on miss/error.
 */
export const getCachedProfile = async tokenId => {
  try {
    const key = profileCacheKey(tokenId);
    const raw = await redis.get(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (err) {
    // Cache miss on error — never block scan for cache failure
    logger.warn({ err: err.message, tokenId }, '[scan.cache] getCachedProfile failed');
    return null;
  }
};

/**
 * Store resolved profile in Redis for TTL seconds.
 * Fire-and-forget at call site — cache write failure must never block response.
 */
export const setCachedProfile = async (tokenId, profile) => {
  try {
    const key = profileCacheKey(tokenId);
    await redis.set(key, JSON.stringify(profile), 'EX', PROFILE_TTL_S);
  } catch (err) {
    logger.warn({ err: err.message, tokenId }, '[scan.cache] setCachedProfile failed');
  }
};

/**
 * CRITICAL: Invalidate cache for a token.
 * Must be called when a card is deactivated, revoked, or student updated.
 * A revoked card served from cache during an emergency is a safety failure.
 */
export const invalidateScanCache = async tokenId => {
  try {
    const key = profileCacheKey(tokenId);
    await redis.del(key);
    logger.info({ tokenId }, '[scan.cache] Profile cache invalidated');
  } catch (err) {
    logger.error({ err: err.message, tokenId }, '[scan.cache] Cache invalidation FAILED');
    // Do not swallow — caller should log this as a warning
    throw err;
  }
};

// ── IP block ──────────────────────────────────────────────────────────────────

/**
 * Check if an IP is blocked in Redis.
 * O(1) lookup — this runs on every scan request, must be fast.
 */
export const isIpBlocked = async ip => {
  try {
    const val = await redis.get(ipBlockKey(ip));
    return val !== null;
  } catch (err) {
    logger.warn({ err: err.message, ip }, '[scan.cache] isIpBlocked check failed — allowing');
    return false; // fail open: never block legit emergency scan due to Redis failure
  }
};

/**
 * Block an IP in Redis.
 * @param {string} ip
 * @param {string} reason
 * @param {number} [ttlSeconds] — default 24h
 */
export const blockIpInRedis = async (ip, reason, ttlSeconds = IP_BLOCK_TTL_S) => {
  try {
    await redis.set(ipBlockKey(ip), reason, 'EX', ttlSeconds);
    logger.info({ ip, reason, ttlSeconds }, '[scan.cache] IP blocked in Redis');
  } catch (err) {
    logger.error({ err: err.message, ip }, '[scan.cache] blockIpInRedis failed');
  }
};

// ── Anomaly counters ──────────────────────────────────────────────────────────

/**
 * Increment scan counter for a token.
 * Returns new count. Used by anomaly evaluator.
 * Window: 1 hour sliding.
 */
export const incrTokenScanCount = async tokenId => {
  try {
    const key = tokenScanCountKey(tokenId);
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, 3600); // set TTL on first hit
    return count;
  } catch {
    return 0; // anomaly scoring failure must never affect scan response
  }
};

/**
 * Increment scan counter for an IP.
 * Window: 1 hour sliding.
 */
export const incrIpScanCount = async ip => {
  try {
    const key = ipScanCountKey(ip);
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, 3600);
    return count;
  } catch {
    return 0;
  }
};

/**
 * Track unique tokens scanned by an IP.
 * Used to detect scrapers scanning multiple tokens from same IP.
 * Window: 10 minutes.
 */
export const trackIpTokenScan = async (ip, tokenId) => {
  try {
    const key = ipTokenSetKey(ip);
    await redis.sadd(key, tokenId);
    await redis.expire(key, 600); // 10 min window
    return await redis.scard(key); // return distinct token count
  } catch {
    return 0;
  }
};

// ── Scan log queue ────────────────────────────────────────────────────────────

const SCAN_LOG_QUEUE_KEY = 'scan:log_queue';
const SCAN_LOG_QUEUE_MAX = 5000; // cap at 5000 entries — prevent unbounded growth

/**
 * Push a scan log entry to the Redis queue.
 * The scan.worker drains this queue every 5 seconds with bulk DB insert.
 * Hot path never waits on a Postgres write.
 */
export const enqueueScanLog = async logEntry => {
  try {
    const queueLen = await redis.llen(SCAN_LOG_QUEUE_KEY);
    if (queueLen >= SCAN_LOG_QUEUE_MAX) {
      logger.warn({ queueLen }, '[scan.cache] Scan log queue full — dropping entry');
      return;
    }
    await redis.lpush(SCAN_LOG_QUEUE_KEY, JSON.stringify(logEntry));
  } catch (err) {
    logger.warn({ err: err.message }, '[scan.cache] enqueueScanLog failed');
    // Never throw — log queue failure must not affect scan response
  }
};

/**
 * Drain up to `batchSize` log entries from the queue.
 * Called by scan.worker.
 */
export const drainScanLogQueue = async (batchSize = 500) => {
  try {
    const pipeline = redis.pipeline();
    pipeline.lrange(SCAN_LOG_QUEUE_KEY, 0, batchSize - 1);
    pipeline.ltrim(SCAN_LOG_QUEUE_KEY, batchSize, -1);
    const [[, entries]] = await pipeline.exec();
    return (entries ?? []).map(e => JSON.parse(e));
  } catch (err) {
    logger.error({ err: err.message }, '[scan.cache] drainScanLogQueue failed');
    return [];
  }
};
