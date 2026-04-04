// =============================================================================
// scan/cache/scan.cache.js — RESQID
//
// Redis profile cache for the scan hot path.
//
// KEY DESIGN:
//   profile:{tokenId}      — full resolved profile, TTL 60s (or custom)
//   ip_block:{ip}          — blocked IP flag, TTL = block duration
//
// INVALIDATION:
//   invalidateScanCache(tokenId) — called by admin when card is
//   deactivated / revoked. A revoked card must NEVER be served from cache.
// =============================================================================

import { redis } from '#config/redis.js';
import { logger } from '#config/logger.js';

const PROFILE_TTL_S = 60;
const DEAD_STATE_TTL_SS = 3600;
const IP_BLOCK_TTL_S = 60 * 60 * 24;

// ── Key builders ─────────────────────────────────────────────────────────────

export const profileCacheKey = tokenId => `scan:profile:${tokenId}`;
export const ipBlockKey = ip => `blocked:ip:${ip}`;
export const tokenScanCountKey = tokenId => `scan:count:token:${tokenId}`;
export const ipScanCountKey = ip => `scan:count:ip:${ip}`;
export const ipTokenSetKey = ip => `scan:tokens_by_ip:${ip}`;

// ── Profile cache ─────────────────────────────────────────────────────────────

export const getCachedProfile = async tokenId => {
  try {
    const key = profileCacheKey(tokenId);
    const raw = await redis.get(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (err) {
    logger.warn({ err: err.message, tokenId }, '[scan.cache] getCachedProfile failed');
    return null;
  }
};

export const setCachedProfile = async (tokenId, profile, ttlSeconds = PROFILE_TTL_S) => {
  try {
    const key = profileCacheKey(tokenId);
    await redis.set(key, JSON.stringify(profile), 'EX', ttlSeconds);
  } catch (err) {
    logger.warn({ err: err.message, tokenId }, '[scan.cache] setCachedProfile failed');
  }
};

export const invalidateScanCache = async tokenId => {
  try {
    const key = profileCacheKey(tokenId);
    await redis.del(key);
    logger.info({ tokenId }, '[scan.cache] Profile cache invalidated');
    return true;
  } catch (err) {
    logger.error({ err: err.message, tokenId }, '[scan.cache] Cache invalidation FAILED');
    return false;
  }
};

// ── IP block ──────────────────────────────────────────────────────────────────

export const isIpBlocked = async ip => {
  try {
    const val = await redis.get(ipBlockKey(ip));
    return val !== null;
  } catch (err) {
    logger.warn({ err: err.message, ip }, '[scan.cache] isIpBlocked check failed — allowing');
    return false;
  }
};

export const blockIpInRedis = async (ip, reason, ttlSeconds = IP_BLOCK_TTL_S) => {
  try {
    await redis.set(ipBlockKey(ip), reason, 'EX', ttlSeconds);
    logger.info({ ip, reason, ttlSeconds }, '[scan.cache] IP blocked in Redis');
  } catch (err) {
    logger.error({ err: err.message, ip }, '[scan.cache] blockIpInRedis failed');
  }
};

// ── Anomaly counters ──────────────────────────────────────────────────────────

export const incrTokenScanCount = async tokenId => {
  try {
    const key = tokenScanCountKey(tokenId);
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, 3600);
    return count;
  } catch {
    return 0;
  }
};

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

export const trackIpTokenScan = async (ip, tokenId) => {
  try {
    const key = ipTokenSetKey(ip);
    await redis.sadd(key, tokenId);
    await redis.expire(key, 600);
    return await redis.scard(key);
  } catch {
    return 0;
  }
};

// ── Scan log queue (FIFO using rpush + lpop) ─────────────────────────────────

const SCAN_LOG_QUEUE_KEY = 'scan:log_queue';
const SCAN_LOG_QUEUE_MAX = 50000;

export const enqueueScanLog = async logEntry => {
  try {
    const queueLen = await redis.llen(SCAN_LOG_QUEUE_KEY);
    if (queueLen >= SCAN_LOG_QUEUE_MAX) {
      logger.warn({ queueLen }, '[scan.cache] Scan log queue full — dropping entry');
      return;
    }
    await redis.rpush(SCAN_LOG_QUEUE_KEY, JSON.stringify(logEntry));
  } catch (err) {
    logger.warn({ err: err.message }, '[scan.cache] enqueueScanLog failed');
  }
};

export const drainScanLogQueue = async (batchSize = 500) => {
  try {
    const entries = [];
    for (let i = 0; i < batchSize; i++) {
      const entry = await redis.lpop(SCAN_LOG_QUEUE_KEY);
      if (!entry) break;
      try {
        entries.push(JSON.parse(entry));
      } catch {
        // Skip malformed entries
      }
    }
    return entries;
  } catch (err) {
    logger.error({ err: err.message }, '[scan.cache] drainScanLogQueue failed');
    return [];
  }
};

export const DEAD_STATE_TTL_S = DEAD_STATE_TTL_SS;