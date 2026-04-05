// =============================================================================
// health.repository.js — RESQID Super Admin
// ONLY raw DB/Redis queries. No business logic.
// Called by health.service.js for real measured data.
// =============================================================================

import { prisma } from '#config/prisma.js';
import { redis } from '#config/redis.js';
import { logger } from '#config/logger.js';

// ─── Redis key prefixes ───────────────────────────────────────────────────────
const UPTIME_PREFIX = 'health:uptime:'; // health:uptime:<serviceId> → list of '1'/'0'
const UPTIME_WINDOW = 200;              // keep last 200 check results per service (~3h at 1min interval)
const UPTIME_TTL    = 86400;            // 24h TTL so stale data auto-expires

// ─── Low-level timing helper ──────────────────────────────────────────────────
/**
 * timed(fn) — runs an async function and returns { ok, latencyMs, error? }
 * Used for every service check so latency is always measured the same way.
 */
async function timed(fn) {
  const start = Date.now();
  try {
    await fn();
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    return { ok: false, latencyMs: null, error: err.message };
  }
}

// ─── Core infrastructure checks ───────────────────────────────────────────────

/**
 * checkDbConnectivity()
 * Runs SELECT 1 — cheapest possible query, measures round-trip to Neon.
 */
export async function checkDbConnectivity() {
  return timed(() => prisma.$queryRaw`SELECT 1`);
}

/**
 * checkRedisConnectivity()
 * PING → PONG. Measures round-trip to Redis.
 */
export async function checkRedisConnectivity() {
  return timed(() => redis.ping());
}

// ─── Application-level health signals ────────────────────────────────────────

/**
 * getNotificationStats()
 * Returns counts of total / failed notifications in the last hour.
 * Used to compute Notification Service health.
 */
export async function getNotificationStats() {
  const since = new Date(Date.now() - 60 * 60 * 1000); // last 1 hour
  try {
    const [total, failed] = await Promise.all([
      prisma.notification.count({ where: { created_at: { gte: since } } }),
      prisma.notification.count({ where: { created_at: { gte: since }, status: 'FAILED' } }),
    ]);
    return { total, failed };
  } catch (err) {
    logger.warn({ err: err.message }, '[health.repo] getNotificationStats failed');
    return { total: 0, failed: 0 };
  }
}

/**
 * getScanStats()
 * Returns counts + latency for scan logs in the last hour.
 * Used to compute QR Scan Service health.
 */
export async function getScanStats() {
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const start = Date.now();
  try {
    const [total, errors] = await Promise.all([
      prisma.scanLog.count({ where: { created_at: { gte: since } } }),
      prisma.scanLog.count({ where: { created_at: { gte: since }, result: 'ERROR' } }),
    ]);
    return { total, errors, queryMs: Date.now() - start };
  } catch (err) {
    logger.warn({ err: err.message }, '[health.repo] getScanStats failed');
    return { total: 0, errors: 0, queryMs: null };
  }
}

/**
 * getAvgScanResponseTime()
 * Returns average response_time_ms from recent scan logs.
 * Gives a real latency estimate for the QR Scan Service.
 */
export async function getAvgScanResponseTime() {
  const since = new Date(Date.now() - 60 * 60 * 1000);
  try {
    const result = await prisma.scanLog.aggregate({
      where: {
        created_at: { gte: since },
        result: 'SUCCESS',
        response_time_ms: { not: null },
      },
      _avg: { response_time_ms: true },
    });
    return result._avg.response_time_ms ? Math.round(result._avg.response_time_ms) : null;
  } catch {
    return null;
  }
}

/**
 * getDlqUnresolved()
 * Returns count of unresolved Dead Letter Queue entries.
 * High DLQ count indicates background job failures (background health signal).
 */
export async function getDlqUnresolved() {
  try {
    return await prisma.deadLetterQueue.count({ where: { resolved: false } });
  } catch {
    return 0;
  }
}

/**
 * getStalledPipelines()
 * Returns count of stalled order pipelines.
 * Useful for system health signal.
 */
export async function getStalledPipelines() {
  try {
    return await prisma.orderPipeline.count({ where: { is_stalled: true } });
  } catch {
    return 0;
  }
}

// ─── Rolling Uptime Tracking (Redis) ─────────────────────────────────────────

/**
 * recordCheckResult(serviceId, success)
 * Appends '1' (success) or '0' (failure) to a Redis list.
 * Trims to UPTIME_WINDOW entries. Ignores Redis failures silently.
 */
export async function recordCheckResult(serviceId, success) {
  const key = `${UPTIME_PREFIX}${serviceId}`;
  try {
    const pipe = redis.pipeline();
    pipe.lpush(key, success ? '1' : '0');
    pipe.ltrim(key, 0, UPTIME_WINDOW - 1);
    pipe.expire(key, UPTIME_TTL);
    await pipe.exec();
  } catch {
    // Redis tracking failure must never break health endpoint response
  }
}

/**
 * getUptimePercent(serviceId)
 * Computes rolling uptime % from stored check results.
 * Returns null if no data exists yet (first run).
 */
export async function getUptimePercent(serviceId) {
  const key = `${UPTIME_PREFIX}${serviceId}`;
  try {
    const results = await redis.lrange(key, 0, -1);
    if (!results || results.length === 0) return null;
    const successes = results.filter(r => r === '1').length;
    // Round to 2 decimal places: e.g. 99.95
    return Math.round((successes / results.length) * 10000) / 100;
  } catch {
    return null;
  }
}

/**
 * getAllUptimes()
 * Batch fetch all service uptimes in one Redis pipeline call.
 * More efficient than N individual getUptimePercent calls.
 */
export async function getAllUptimes(serviceIds) {
  try {
    const pipe = redis.pipeline();
    serviceIds.forEach(id => pipe.lrange(`${UPTIME_PREFIX}${id}`, 0, -1));
    const results = await pipe.exec();

    return serviceIds.reduce((acc, id, idx) => {
      const list = results[idx]?.[1]; // [err, value] from pipeline
      if (!list || !list.length) {
        acc[id] = null;
      } else {
        const successes = list.filter(r => r === '1').length;
        acc[id] = Math.round((successes / list.length) * 10000) / 100;
      }
      return acc;
    }, {});
  } catch {
    // Return null for all on Redis failure
    return serviceIds.reduce((acc, id) => ({ ...acc, [id]: null }), {});
  }
}