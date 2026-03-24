// =============================================================================
// modules/school_admin/notifications/notification.service.js — RESQID
// Responsibility: orchestration + caching. No Prisma.
//
// CACHE STRATEGY
// ─────────────────────────────────────────────────────────────────────────────
// Stats (unread count for header badge):
//   → Cached at notif_stats:{schoolId} (TTL: 30s)
//   → Same logic as anomaly stats — badge must update quickly after markRead
//   → Busted explicitly after every markRead / markAllRead
//
// Notification list:
//   → NOT cached — filter/page combos vary, and notifications are append-only
//   → Fast via @@index([school_id]) + @@index([status, created_at])
// =============================================================================

import * as repo from "./notification.repository.js";
import { cacheAside, cacheDel } from "../../../utils/cache/cache.js";
import { buildOffsetMeta } from "../../../utils/response/paginate.js";

const STATS_KEY = (schoolId) => `notif_stats:${schoolId}`;
const STATS_TTL = 30; // 30s — badge must feel instant after reading

export async function getNotificationInventory(schoolId, query) {
  const { filter, page, limit } = query;
  const skip = (page - 1) * limit;

  // List + stats in parallel — stats uses cache, list always hits DB
  const [{ notifications, total }, stats] = await Promise.all([
    repo.findNotifications({ schoolId, filter, skip, take: limit }),
    getStatsCached(schoolId),
  ]);

  return {
    notifications,
    stats,
    meta: buildOffsetMeta(total, page, limit),
  };
}

async function getStatsCached(schoolId) {
  return cacheAside(STATS_KEY(schoolId), STATS_TTL, () =>
    repo.getNotificationStats(schoolId),
  );
}

/**
 * markOneRead({ notificationId, schoolId })
 * Returns: shaped notification | null (not found / wrong school / already read)
 */
export async function markOneRead({ notificationId, schoolId }) {
  const notification = await repo.markOneRead({ notificationId, schoolId });

  if (!notification) return null;

  // Bust unread badge — count just dropped by 1
  await invalidateNotifStats(schoolId);

  return notification;
}

/**
 * markAllRead(schoolId)
 * Returns: { count } — how many were flipped to SENT
 */
export async function markAllRead(schoolId) {
  const result = await repo.markAllRead(schoolId);

  // Bust badge — all unread cleared
  await invalidateNotifStats(schoolId);

  return result;
}

export async function invalidateNotifStats(schoolId) {
  await cacheDel(STATS_KEY(schoolId));
}
