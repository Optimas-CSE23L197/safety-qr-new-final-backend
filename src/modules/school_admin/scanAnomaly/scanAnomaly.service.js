// =============================================================================
// modules/school_admin/anomalies/anomaly.service.js — RESQID
// Responsibility: orchestration + caching. No Prisma.
//
// CACHE STRATEGY
// ─────────────────────────────────────────────────────────────────────────────
// Stats (unresolved count for header badge):
//   → Cached at anomaly_stats:{schoolId} (TTL: 30s)
//   → Short TTL because resolving an anomaly should update the badge quickly
//   → Invalidated explicitly on every resolve action
//
// Anomaly list:
//   → NOT cached — filter/type/page combos are too varied
//   → Query is fast via @@index([resolved]) + @@index([token_id])
// =============================================================================

import * as repo from "./scanAnomaly.repository.js";
import { cacheAside, cacheDel } from "../../../utils/cache/cache.js";
import { buildOffsetMeta } from "../../../utils/response/paginate.js";

const STATS_KEY = (schoolId) => `anomaly_stats:${schoolId}`;
const STATS_TTL = 30; // 30 seconds — badge must feel real-time after resolving

export async function getAnomalyInventory(schoolId, query) {
  const { filter, type, page, limit } = query;
  const skip = (page - 1) * limit;

  // List + stats in parallel — stats uses cache, list always hits DB
  const [{ anomalies, total }, stats] = await Promise.all([
    repo.findAnomalies({ schoolId, filter, type, skip, take: limit }),
    getStatsCached(schoolId),
  ]);

  return {
    anomalies,
    stats,
    meta: buildOffsetMeta(total, page, limit),
  };
}

async function getStatsCached(schoolId) {
  return cacheAside(STATS_KEY(schoolId), STATS_TTL, () =>
    repo.getAnomalyStats(schoolId),
  );
}

/**
 * resolveAnomaly({ anomalyId, schoolId, resolvedBy, notes })
 *
 * Returns: { anomaly } on success
 * Throws:  404-style null → controller converts to 404
 */
export async function resolveAnomaly({
  anomalyId,
  schoolId,
  resolvedBy,
  notes,
}) {
  const anomaly = await repo.resolveAnomaly({
    anomalyId,
    schoolId,
    resolvedBy,
    notes,
  });

  if (!anomaly) return null;

  // Bust stats cache — unresolved count just changed
  await invalidateAnomalyStats(schoolId);

  return anomaly;
}

export async function invalidateAnomalyStats(schoolId) {
  await cacheDel(STATS_KEY(schoolId));
}
