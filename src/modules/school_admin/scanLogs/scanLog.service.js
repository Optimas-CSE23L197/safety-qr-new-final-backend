// =============================================================================
// modules/school_admin/scan_logs/scanlog.service.js — RESQID
// Responsibility: orchestration + caching. No Prisma.
//
// CACHE STRATEGY
// ─────────────────────────────────────────────────────────────────────────────
// Stats bar (total/success/failed/avgResponseMs):
//   → Cached at scan_log_stats:{schoolId}:{dateKey} (TTL: 1min)
//   → dateKey = "today" when no range supplied, ISO date string otherwise
//   → Short TTL because scan events are real-time — stale stats look broken
//   → Scoped by date so "today" and "all time" don't share a cache entry
//
// Log list:
//   → NOT cached — highly dynamic (search, filter, pagination, date combos)
//   → List query is fast with @@index([school_id, created_at]) hot path
//
// Invalidation:
//   → call invalidateScanLogStats(schoolId) from the public scan endpoint
//     after every successful ScanLog write (cheap cacheDel call)
// =============================================================================

import * as repo from './scanLog.repository.js';
import { cacheAside, cacheDel } from '#utils/cache/cache.js';
import { buildOffsetMeta } from '#utils/response/paginate.js';

const STATS_TTL = 60; // 1 minute — scans are real-time, keep stats fresh

/**
 * Cache key includes a date bucket so filtering by "today" vs "all time"
 * produces separate cache entries and don"t pollute each other.
 */
function statsKey(schoolId, from, to) {
  // No date range supplied → "today" bucket
  if (!from && !to) {
    const today = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
    return `scan_log_stats:${schoolId}:${today}`;
  }
  // Date range supplied → encode range in key
  const f = from ? from.toISOString().slice(0, 10) : 'start';
  const t = to ? to.toISOString().slice(0, 10) : 'end';
  return `scan_log_stats:${schoolId}:${f}_${t}`;
}

export async function getScanLogInventory(schoolId, query) {
  const { result, search, from, to, page, limit } = query;
  const skip = (page - 1) * limit;

  // Run list query + stats in parallel
  // Stats uses cache — list always hits DB
  const [{ logs, total }, stats] = await Promise.all([
    repo.findScanLogs({
      schoolId,
      result,
      search,
      from,
      to,
      skip,
      take: limit,
    }),
    getStatsCached(schoolId, from, to),
  ]);

  return {
    logs,
    stats,
    meta: buildOffsetMeta(total, page, limit),
  };
}

async function getStatsCached(schoolId, from, to) {
  const key = statsKey(schoolId, from, to);
  return cacheAside(key, STATS_TTL, () => repo.getScanLogStats({ schoolId, from, to }));
}

/**
 * Call this from the public scan endpoint after every ScanLog write.
 * Busts ONLY today's stats cache — historical date range caches are unaffected
 * (they're immutable once the day has passed).
 */
export async function invalidateScanLogStats(schoolId) {
  const today = new Date().toISOString().slice(0, 10);
  await cacheDel(`scan_log_stats:${schoolId}:${today}`);
}
