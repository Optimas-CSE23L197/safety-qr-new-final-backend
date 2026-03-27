// =============================================================================
// modules/school_admin/tokens/tokens.service.js — RESQID
// Responsibility: orchestration + caching. No Prisma.
//
// CACHE STRATEGY
// ─────────────────────────────────────────────────────────────────────────────
// Stats bar (ACTIVE/UNASSIGNED/EXPIRED/REVOKED counts):
//   → Cached separately at token_stats:{schoolId} (TTL: 2min)
//   → Stats don't change with every filter/search change
//   → Single groupBy query cached — saves DB hit on every page load
//
// Token list:
//   → NOT cached — highly dynamic (search, filter, pagination combos)
//   → Each unique query combo would need its own cache key
//   → Not worth it — list query is fast with proper indexes
//
// Invalidation:
//   → call invalidateTokenStats(schoolId) when:
//       - token status changes (revoke, activate, expire)
//       - new tokens assigned to students
// =============================================================================

import * as repo from './token.repository.js';
import { cacheAside, cacheDel } from '#utils/cache/cache.js';
import { buildOffsetMeta } from '#utils/response/paginate.js';

const STATS_KEY = schoolId => `token_stats:${schoolId}`;
const STATS_TTL = 2 * 60; // 2 minutes

export async function getTokenInventory(schoolId, query) {
  const { status, search, page, limit } = query;
  const skip = (page - 1) * limit;

  // Run list query + stats in parallel
  // Stats uses cache — list always hits DB
  const [{ tokens, total }, stats] = await Promise.all([
    repo.findTokens({ schoolId, status, search, skip, take: limit }),
    getStatsCached(schoolId),
  ]);

  return {
    tokens,
    stats,
    meta: buildOffsetMeta(total, page, limit),
  };
}

async function getStatsCached(schoolId) {
  return cacheAside(STATS_KEY(schoolId), STATS_TTL, () => repo.getTokenStats(schoolId));
}

export async function invalidateTokenStats(schoolId) {
  await cacheDel(STATS_KEY(schoolId));
}
