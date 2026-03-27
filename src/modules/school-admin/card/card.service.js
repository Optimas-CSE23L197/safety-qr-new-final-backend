// =============================================================================
// modules/school_admin/card_requests/cardRequests.service.js — RESQID
// Responsibility: orchestration + cache. No Prisma.
// =============================================================================

import * as repo from './card.repository.js';
import { cacheAside, cacheDel } from '#utils/cache/cache.js';
import { buildOffsetMeta } from '#utils/response/paginate.js';

// Cache only the PENDING count for the dashboard badge — not the full list
// Full list is not cached (dynamic filters + pagination make it impractical)
const PENDING_COUNT_KEY = schoolId => `card_requests:pending_count:${schoolId}`;
const PENDING_COUNT_TTL = 60; // 1 minute

export async function listCardRequests(schoolId, query) {
  const { status, search, page, limit } = query;
  const skip = (page - 1) * limit;

  const { orders, total, counts } = await repo.findCardRequests({
    schoolId,
    status,
    search,
    skip,
    take: limit,
  });

  return {
    orders,
    counts,
    meta: buildOffsetMeta(total, page, limit),
  };
}

export async function submitCardRequest(schoolId, schoolUserId, body) {
  const order = await repo.createCardOrder({ schoolId, schoolUserId, body });

  // Invalidate dashboard cache — new pending order changes the count
  await invalidateCardRequestCache(schoolId);

  return order;
}

/**
 * invalidateCardRequestCache(schoolId)
 * Call from: submitCardRequest, and from super admin when they approve/reject
 */
export async function invalidateCardRequestCache(schoolId) {
  await cacheDel(PENDING_COUNT_KEY(schoolId));
  // Also invalidate dashboard so pending requests badge updates
  await cacheDel(`dashboard:${schoolId}`);
}
