// =============================================================================
// monitoring.service.js — RESQID School Admin › Scan Monitoring
// Business logic + Redis caching layer
// =============================================================================

import { redis }    from "../../../config/redis.js";
import { logger }   from "../../../config/logger.js";
import { ApiError } from "../../../utils/response/ApiError.js";
import * as repo    from "./monitoring.repository.js";

// ─── Cache config ─────────────────────────────────────────────────────────────

const TTL = {
  stats:     30,   // 30 s — live KPI dashboard
  trend:     120,  // 2 min — area chart
  breakdown: 30,   // 30 s — donut chart
  unread:    15,   // 15 s — bell badge poll
};

const cacheKey = (schoolId, suffix) => `monitoring:${schoolId}:${suffix}`;

const getCached = async (key, ttl, fn) => {
  try {
    const hit = await redis.get(key);
    if (hit) return JSON.parse(hit);
  } catch { /* redis miss — fall through */ }

  const data = await fn();

  redis.setex(key, ttl, JSON.stringify(data)).catch((err) =>
    logger.warn({ err }, "monitoring cache set failed"),
  );

  return data;
};

/** Bust all monitoring cache for a school (call after any write) */
export const bustCache = (schoolId) =>
  Promise.all(
    ["stats", "trend", "breakdown", "unread"].map((s) =>
      redis.del(cacheKey(schoolId, s)).catch(() => {}),
    ),
  );

// ─── Stats / Charts ───────────────────────────────────────────────────────────

export const getStats = (schoolId) =>
  getCached(cacheKey(schoolId, "stats"), TTL.stats, () =>
    repo.getScanStats(schoolId),
  );

export const getScanTrend = (schoolId) =>
  getCached(cacheKey(schoolId, "trend"), TTL.trend, () =>
    repo.getScanTrend(schoolId),
  );

export const getResultBreakdown = (schoolId) =>
  getCached(cacheKey(schoolId, "breakdown"), TTL.breakdown, () =>
    repo.getResultBreakdown(schoolId),
  );

/**
 * Full overview — all three in parallel, one Redis round-trip each
 */
export const getOverview = async (schoolId) => {
  const [stats, scanTrend, resultBreakdown] = await Promise.all([
    getStats(schoolId),
    getScanTrend(schoolId),
    getResultBreakdown(schoolId),
  ]);
  return { stats, scanTrend, resultBreakdown };
};

// ─── Scan Logs ────────────────────────────────────────────────────────────────

export const listScanLogs = async (schoolId, query) => {
  const { total, items } = await repo.listScanLogs(schoolId, query);
  return buildPage(items, total, query);
};

export const getScanLog = async (schoolId, id) => {
  const log = await repo.findScanLogById(schoolId, id);
  if (!log) throw ApiError.notFound("Scan log not found");
  return log;
};

// ─── Anomalies ────────────────────────────────────────────────────────────────

export const listAnomalies = async (schoolId, query) => {
  const { total, items } = await repo.listAnomalies(schoolId, query);
  return buildPage(items, total, query);
};

export const resolveAnomaly = async (schoolId, anomalyId, resolvedBy, notes) => {
  const anomaly = await repo.findAnomalyById(schoolId, anomalyId);
  if (!anomaly)          throw ApiError.notFound("Anomaly not found");
  if (anomaly.resolved)  throw ApiError.conflict("Anomaly is already resolved");

  const updated = await repo.markAnomalyResolved(anomalyId, resolvedBy, notes);

  // Bust stats cache — unresolved count changed
  await bustCache(schoolId);

  logger.info(
    { schoolId, anomalyId, resolvedBy },
    "monitoring: anomaly resolved",
  );

  return updated;
};

// ─── Multi-Device ─────────────────────────────────────────────────────────────

export const getMultiDeviceScans = async (schoolId, query) => {
  const { total, items } = await repo.getMultiDeviceScans(schoolId, query);
  return buildPage(items, total, query);
};

// ─── Notifications ────────────────────────────────────────────────────────────

export const listNotifications = async (schoolId, query) => {
  const { total, items } = await repo.listNotifications(schoolId, query);
  return buildPage(items, total, query);
};

export const getUnreadCount = async (schoolId) => {
  const key    = cacheKey(schoolId, "unread");
  const cached = await redis.get(key).catch(() => null);

  if (cached !== null) return { unread: parseInt(cached, 10) };

  const count = await repo.getUnreadCount(schoolId);
  redis.setex(key, TTL.unread, String(count)).catch(() => {});
  return { unread: count };
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const buildPage = (items, total, { page, limit }) => ({
  items,
  meta: {
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    hasNext:    page * limit < total,
    hasPrev:    page > 1,
  },
});