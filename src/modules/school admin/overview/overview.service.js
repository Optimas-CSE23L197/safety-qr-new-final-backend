// =============================================================================
// monitoring.service.js — RESQID School Admin
// Business logic — orchestrates repo calls, Redis caching, error throwing
// =============================================================================

import { redis }    from "../../../config/redis.js";
import { logger }   from "../../../config/logger.js";
import { ApiError } from "../../../utils/Response/ApiError.js";
import * as repo    from "./overview.repository.js";

// ─── Cache TTLs ───────────────────────────────────────────────────────────────
const TTL_STATS    = 60;   // KPI stats — 60 s
const TTL_TREND    = 120;  // 7-day chart — 2 min
const TTL_BREAKDOWN = 60;  // token donut — 60 s
const TTL_UNREAD   = 20;   // notification badge — 20 s

const cacheKey = (schoolId, suffix) => `monitoring:${schoolId}:${suffix}`;

async function cachedGet(key, ttl, fetcher) {
  const hit = await redis.get(key).catch(() => null);
  if (hit) return JSON.parse(hit);
  const data = await fetcher();
  redis.setex(key, ttl, JSON.stringify(data)).catch(() => {});
  return data;
}

export const bustCache = async (schoolId) => {
  const keys = ["stats", "trend", "breakdown", "unread"];
  await Promise.all(
    keys.map((k) => redis.del(cacheKey(schoolId, k)).catch(() => {})),
  );
};

// ─── Overview Stats ───────────────────────────────────────────────────────────

export const getStats = async (schoolId) =>
  cachedGet(cacheKey(schoolId, "stats"), TTL_STATS, () =>
    repo.getMonitoringStats(schoolId),
  );

export const getScanTrend = async (schoolId) =>
  cachedGet(cacheKey(schoolId, "trend"), TTL_TREND, () =>
    repo.getScanTrend(schoolId),
  );

export const getTokenBreakdown = async (schoolId) =>
  cachedGet(cacheKey(schoolId, "breakdown"), TTL_BREAKDOWN, () =>
    repo.getTokenBreakdown(schoolId),
  );

/**
 * Full monitoring overview — all KPI data in one shot
 * Aggregates stats + trend + breakdown + top anomalies + recent scans
 */
export const getFullOverview = async (schoolId) => {
  const [stats, scanTrend, tokenBreakdown, recentAnomalies, recentScans] =
    await Promise.all([
      getStats(schoolId),
      getScanTrend(schoolId),
      getTokenBreakdown(schoolId),
      repo
        .listAnomalies(schoolId, { page: 1, limit: 5, sortDir: "desc", resolved: false })
        .then(({ items }) => items),
      repo
        .listScanLogs(schoolId, { page: 1, limit: 5, sortDir: "desc" })
        .then(({ items }) => items),
    ]);

  return { stats, scanTrend, tokenBreakdown, recentAnomalies, recentScans };
};

// ─── Student Activity ─────────────────────────────────────────────────────────

export const listStudentActivity = async (schoolId, query) => {
  const { total, items } = await repo.listStudentActivity(schoolId, query);
  return paginate(items, total, query);
};

// ─── Tokens ───────────────────────────────────────────────────────────────────

export const listTokens = async (schoolId, query) => {
  const { total, items } = await repo.listTokens(schoolId, query);
  return paginate(items, total, query);
};

// ─── Scan Logs ────────────────────────────────────────────────────────────────

export const listScanLogs = async (schoolId, query) => {
  const { total, items } = await repo.listScanLogs(schoolId, query);
  return paginate(items, total, query);
};

// ─── Anomalies ────────────────────────────────────────────────────────────────

export const listAnomalies = async (schoolId, query) => {
  const { total, items } = await repo.listAnomalies(schoolId, query);
  return paginate(items, total, query);
};

export const resolveAnomaly = async (schoolId, anomalyId, resolvedBy, notes) => {
  const anomaly = await repo.findAnomalyById(schoolId, anomalyId);
  if (!anomaly)  throw ApiError.notFound("Anomaly");
  if (anomaly.resolved) throw ApiError.conflict("Anomaly is already resolved");

  const updated = await repo.markAnomalyResolved(anomalyId, resolvedBy, notes);
  await bustCache(schoolId);
  return updated;
};

// ─── Parent Requests ──────────────────────────────────────────────────────────

export const listParentRequests = async (schoolId, query) => {
  const { total, items } = await repo.listParentRequests(schoolId, query);
  return paginate(items, total, query);
};

// ─── Emergency Profiles ───────────────────────────────────────────────────────

export const listEmergencyProfiles = async (schoolId, query) => {
  const { total, items } = await repo.listEmergencyProfiles(schoolId, query);
  return paginate(items, total, query);
};

export const getEmergencyProfile = async (schoolId, studentId) => {
  const profile = await repo.findEmergencyProfileByStudent(schoolId, studentId);
  if (!profile) throw ApiError.notFound("Emergency profile");
  return profile;
};

// ─── Notifications ────────────────────────────────────────────────────────────

export const listNotifications = async (schoolId, query) => {
  const { total, items } = await repo.listNotifications(schoolId, query);
  return paginate(items, total, query);
};

export const getUnreadCount = async (schoolId) => {
  const key    = cacheKey(schoolId, "unread");
  const cached = await redis.get(key).catch(() => null);
  if (cached) return { unread: parseInt(cached, 10) };

  const count = await repo.getUnreadNotifCount(schoolId);
  redis.setex(key, TTL_UNREAD, String(count)).catch(() => {});
  return { unread: count };
};

/**
 * dispatchScanAlert
 * Called externally (e.g. from scan.service.js) whenever a QR is scanned.
 * Creates a SCAN_ALERT notification + busts the unread cache so the badge
 * updates on next poll.
 */
export const dispatchScanAlert = async ({ schoolId, studentId, parentId, scanResult, tokenId, scannedAt }) => {
  try {
    await repo.createScanAlertNotification({
      schoolId,
      studentId,
      parentId,
      payload: { result: scanResult, token_id: tokenId, scanned_at: scannedAt },
    });
    // Bust unread cache so badge increments on next frontend poll
    await redis.del(cacheKey(schoolId, "unread")).catch(() => {});
    await redis.del(cacheKey(schoolId, "stats")).catch(() => {});

    logger.info({ schoolId, studentId, scanResult }, "Scan alert notification queued");
  } catch (err) {
    // Non-critical — log and continue, never fail the scan because of this
    logger.error({ err: err.message, schoolId }, "Failed to dispatch scan alert notification");
  }
};

// ─── Helper ───────────────────────────────────────────────────────────────────

function paginate(items, total, { page, limit }) {
  return {
    items,
    meta: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      hasNext:    page * limit < total,
      hasPrev:    page > 1,
    },
  };
}