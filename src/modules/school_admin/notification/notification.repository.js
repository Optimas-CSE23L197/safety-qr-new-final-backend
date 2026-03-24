// =============================================================================
// modules/school_admin/notifications/notification.repository.js — RESQID
// ALL Prisma calls for notifications. Nothing else.
//
// SCHEMA NOTES
// ─────────────────────────────────────────────────────────────────────────────
// Notification model has NO title/body columns.
// title + body are stored inside payload: Json? by the system that creates them.
// Convention enforced here:
//   payload.title  — notification headline
//   payload.body   — notification body text
//   payload.*      — any extra context (student_id, token_hash, etc.)
//
// NotificationStatus enum: QUEUED | SENT | FAILED | SUPPRESSED
//   Frontend treats QUEUED = "unread", SENT = "read".
//   markRead / markAllRead set status → SENT.
//   FAILED / SUPPRESSED shown as-is in the list.
//
// PERFORMANCE STRATEGY
// ─────────────────────────────────────────────────────────────────────────────
// GROUP A (always parallel):
//   Q1: Notification.findMany  — paginated rows
//   Q2: Notification.count     — total for current filter
//
// GROUP B (stats — cached in service layer):
//   Q3: Notification.count(status: QUEUED, school_id)
//       Single count query — all the frontend needs is the unread integer badge.
//
// WRITE OPS:
//   markOneRead    → updateMany(id + school_id + status QUEUED) → 0 rows = 404
//   markAllRead    → updateMany(school_id + status QUEUED) → bulk flip to SENT
//   Both use updateMany (not update) for the school_id ownership check.
//
// INDEXES USED:
//   @@index([school_id])           — base filter
//   @@index([status, created_at])  — unread-first sort HOT PATH
//   @@index([status])              — unread count query
//   @@index([type])                — type filter
// =============================================================================

import { prisma } from "../../../config/prisma.js";

/**
 * findNotifications({ schoolId, filter, skip, take })
 * Returns: { notifications, total }
 */
export async function findNotifications({ schoolId, filter, skip, take }) {
  const where = buildWhere({ schoolId, filter });

  const [rows, total] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: [
        // QUEUED (unread) rows float to top — mirrors frontend unread-first display
        { status: "asc" },
        { created_at: "desc" },
      ],
      skip,
      take,
      select: {
        id: true,
        type: true,
        channel: true,
        status: true,
        payload: true, // title + body + extra context live here
        sent_at: true,
        created_at: true,

        // Student name — nullable, joined only when student_id is set
        student: {
          select: {
            first_name: true,
            last_name: true,
          },
        },
      },
    }),

    prisma.notification.count({ where }),
  ]);

  const notifications = rows.map(shapeNotification);
  return { notifications, total };
}

/**
 * getNotificationStats(schoolId)
 * Returns: { unread }
 * Cached in service layer — invalidated on markRead / markAllRead.
 */
export async function getNotificationStats(schoolId) {
  const unread = await prisma.notification.count({
    where: {
      school_id: schoolId,
      status: "QUEUED",
    },
  });

  return { unread };
}

/**
 * markOneRead({ notificationId, schoolId })
 *
 * Ownership check baked into WHERE: school_id must match.
 * Only flips QUEUED → SENT. Already-read = no-op → returns null.
 * Returns: shaped notification | null (not found / wrong school / already read)
 */
export async function markOneRead({ notificationId, schoolId }) {
  const result = await prisma.notification.updateMany({
    where: {
      id: notificationId,
      school_id: schoolId, // ownership guard
      status: "QUEUED", // idempotency — don't re-mark SENT/FAILED
    },
    data: {
      status: "SENT",
      sent_at: new Date(),
    },
  });

  if (result.count === 0) return null;

  // Fetch updated row to return shaped data to controller
  const updated = await prisma.notification.findUnique({
    where: { id: notificationId },
    select: {
      id: true,
      type: true,
      channel: true,
      status: true,
      payload: true,
      sent_at: true,
      created_at: true,
      student: {
        select: { first_name: true, last_name: true },
      },
    },
  });

  return updated ? shapeNotification(updated) : null;
}

/**
 * markAllRead(schoolId)
 *
 * Bulk flip: all QUEUED → SENT for this school.
 * Returns: { count } — number of notifications marked read.
 */
export async function markAllRead(schoolId) {
  const result = await prisma.notification.updateMany({
    where: {
      school_id: schoolId,
      status: "QUEUED",
    },
    data: {
      status: "SENT",
      sent_at: new Date(),
    },
  });

  return { count: result.count };
}

// ─── WHERE Builder ────────────────────────────────────────────────────────────

function buildWhere({ schoolId, filter }) {
  const where = { school_id: schoolId };

  if (filter === "UNREAD") {
    // Only unread notifications
    where.status = "QUEUED";
  } else if (filter !== "ALL") {
    // filter is a NotificationType value e.g. "SCAN_ANOMALY"
    where.type = filter;
  }

  return where;
}

// ─── Shape ────────────────────────────────────────────────────────────────────

function shapeNotification(n) {
  // Extract title + body from payload JSON
  // payload is typed as Json? — coerce safely
  const payload = n.payload && typeof n.payload === "object" ? n.payload : {};

  return {
    id: n.id,
    type: n.type,
    channel: n.channel,
    status: n.status,
    // title/body extracted from payload — frontend displays these directly
    title: payload.title ?? humanizeFallbackTitle(n.type),
    body: payload.body ?? null,
    // Extra payload context passed through — frontend can use if needed
    payload_meta: omit(payload, ["title", "body"]),
    student_name: n.student
      ? `${n.student.first_name ?? ""} ${n.student.last_name ?? ""}`.trim() ||
        null
      : null,
    sent_at: n.sent_at,
    created_at: n.created_at,
  };
}

/**
 * Fallback title if notification was created without payload.title.
 * Matches labels used in the frontend TYPE_META.
 */
function humanizeFallbackTitle(type) {
  const titles = {
    SCAN_ALERT: "Scan Alert",
    SCAN_ANOMALY: "Suspicious scan detected",
    CARD_EXPIRING: "Card Expiring Soon",
    CARD_REVOKED: "Card Revoked",
    CARD_REPLACED: "Card Replaced",
    BILLING_ALERT: "Billing Alert",
    DEVICE_LOGIN: "New Device Login",
    SYSTEM: "System Notification",
  };
  return titles[type] ?? "Notification";
}

/** Shallow omit helper — avoids lodash dependency */
function omit(obj, keys) {
  const out = { ...obj };
  for (const k of keys) delete out[k];
  return out;
}
