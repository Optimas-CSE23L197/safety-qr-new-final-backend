// =============================================================================
// cache.js — RESQID
// Redis cache abstraction — typed helpers, namespaced keys, JSON auto-parse
// All cache operations are fire-safe — never throw and crash the request
// On Redis failure → log warn, serve from DB (graceful degradation)
// =============================================================================

import { redis } from '#config/database/redis.js';
import { logger } from '#config/logger.js';

// ─── TTL Constants (seconds) ──────────────────────────────────────────────────
export const TTL = {
  SCHOOL: 5 * 60, // 5 min  — school settings, rare changes
  SESSION: 60, // 1 min  — session active check
  PARENT_CHILDREN: 2 * 60, // 2 min  — parent-student links
  EMERGENCY_PAGE: 30, // 30 sec — public page (changes rarely but critical)
  TOKEN_STATUS: 60, // 1 min  — token active/revoked status
  USER_PROFILE: 5 * 60, // 5 min  — parent/school user profile
  SCAN_RATE: 60, // 1 min  — rate limit windows
  OTP_BLOCK: 15 * 60, // 15 min — OTP send block per phone
  SHORT: 30, // 30 sec — volatile data
  MEDIUM: 10 * 60, // 10 min — semi-stable data
  LONG: 60 * 60, // 1 hour — stable reference data
};

// ─── Key Builders ─────────────────────────────────────────────────────────────
// All keys centralized — prevents typos and enables easy pattern-based invalidation

export const CacheKey = {
  school: id => `school:${id}`,
  schoolSettings: id => `school:settings:${id}`,
  session: id => `session:${id}`,
  parentChildren: parentId => `parent:children:${parentId}`,
  parentProfile: parentId => `parent:profile:${parentId}`,
  tokenStatus: tokenHash => `token:status:${tokenHash}`,
  emergencyPage: tokenHash => `emergency:${tokenHash}`,
  blacklist: tokenHash => `blacklist:${tokenHash}`,
  scanCount: tokenHash => `scan:count:${tokenHash}`,
  otpBlock: phone => `otp:block:${phone}`,
  ipBlock: ip => `ip:block:${ip}`,
  rateLimitKey: (id, type) => `rl:${type}:${id}`,
};

// ─── Core Cache Operations ────────────────────────────────────────────────────

/**
 * cacheGet(key)
 * Returns parsed JSON or null — never throws
 */
export async function cacheGet(key) {
  try {
    const value = await redis.get(key);
    if (value === null) return null;
    return JSON.parse(value);
  } catch (err) {
    logger.warn({ key, err: err.message }, 'Cache GET failed — serving from DB');
    return null;
  }
}

/**
 * cacheSet(key, value, ttlSeconds)
 * JSON-serializes value and sets with TTL — never throws
 */
export async function cacheSet(key, value, ttlSeconds) {
  try {
    await redis.setex(key, ttlSeconds, JSON.stringify(value));
    return true;
  } catch (err) {
    logger.warn({ key, err: err.message }, 'Cache SET failed');
    return false;
  }
}

/**
 * cacheDel(...keys)
 * Delete one or more keys — never throws
 */
export async function cacheDel(...keys) {
  if (!keys.length) return 0;
  try {
    return await redis.del(...keys);
  } catch (err) {
    logger.warn({ keys, err: err.message }, 'Cache DEL failed');
    return 0;
  }
}

/**
 * cacheDelPattern(pattern)
 * Delete all keys matching a glob pattern
 * Use sparingly — SCAN is O(N) on keyspace
 * Example: cacheDelPattern('school:settings:*')
 */
export async function cacheDelPattern(pattern) {
  try {
    let cursor = '0';
    let deleted = 0;
    do {
      const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = nextCursor;
      if (keys.length) {
        await redis.del(...keys);
        deleted += keys.length;
      }
    } while (cursor !== '0');
    return deleted;
  } catch (err) {
    logger.warn({ pattern, err: err.message }, 'Cache SCAN/DEL pattern failed');
    return 0;
  }
}

/**
 * cacheExists(key)
 * Check if key exists — faster than GET for boolean checks
 */
export async function cacheExists(key) {
  try {
    const result = await redis.exists(key);
    return result === 1;
  } catch (err) {
    logger.warn({ key, err: err.message }, 'Cache EXISTS failed');
    return false;
  }
}

// ─── Cache-Aside Pattern ──────────────────────────────────────────────────────

/**
 * cacheAside(key, ttl, fetchFn)
 * Classic cache-aside: check cache → miss → fetch from DB → store in cache
 * Never throws — falls back to DB on any cache error
 *
 * @example
 * const school = await cacheAside(
 *   CacheKey.school(id),
 *   TTL.SCHOOL,
 *   () => prisma.school.findUnique({ where: { id } })
 * )
 */
export async function cacheAside(key, ttl, fetchFn) {
  // 1. Try cache
  const cached = await cacheGet(key);
  if (cached !== null) return cached;

  // 2. Fetch from DB
  const fresh = await fetchFn();

  // 3. Store in cache (only if value found)
  if (fresh !== null && fresh !== undefined) {
    await cacheSet(key, fresh, ttl);
  }

  return fresh;
}

// ─── Increment/Counter ────────────────────────────────────────────────────────

/**
 * cacheIncr(key, ttlSeconds?)
 * Atomic increment — for rate limiting, scan counting
 * Sets TTL only on first increment (creating the key)
 * @returns {number} new value
 */
export async function cacheIncr(key, ttlSeconds = null) {
  try {
    const val = await redis.incr(key);
    if (val === 1 && ttlSeconds) {
      await redis.expire(key, ttlSeconds);
    }
    return val;
  } catch (err) {
    logger.warn({ key, err: err.message }, 'Cache INCR failed');
    return 0;
  }
}

/**
 * cacheTtl(key)
 * Get remaining TTL in seconds — -1 = no TTL, -2 = key not found
 */
export async function cacheTtl(key) {
  try {
    return await redis.ttl(key);
  } catch {
    return -2;
  }
}
