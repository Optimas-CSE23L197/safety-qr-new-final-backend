// =============================================================================
// notification.service.js — RESQID Super Admin
// Business logic layer — shapes data for controllers, calls repository
// =============================================================================

import { ApiError }   from '#shared/response/ApiError.js';
import { buildOffsetMeta } from '#shared/response/paginate.js';
import * as Repo from './notification.repository.js';

// ─── List Notifications ───────────────────────────────────────────────────────

/**
 * listNotifications(params)
 * Called by GET /api/super-admin/notifications
 *
 * Returns paginated list + meta block.
 * Shapes each row into the flat object the frontend table expects:
 *   { id, recipient, school_name, type, channel, status,
 *     sent_at, error, payload, student, parent }
 */
export async function listNotifications({
  page,
  limit,
  school_id,
  type,
  channel,
  status,
  date_range,
  date_from,
  date_to,
}) {
  const skip = (page - 1) * limit;

  const { notifications, total } = await Repo.findMany({
    filters: {
      school_id,
      type,
      channel,
      status,
      dateRange: date_range,
      dateFrom:  date_from,
      dateTo:    date_to,
    },
    skip,
    take: limit,
  });

  const data = notifications.map(shapeNotification);
  const meta = buildOffsetMeta(total, page, limit);

  return { data, meta };
}

// ─── Single Notification ──────────────────────────────────────────────────────

/**
 * getNotificationById(id)
 * Called by GET /api/super-admin/notifications/:id
 *
 * Used when the frontend requests full payload details
 * (e.g. the "View Payload" modal with JSON viewer).
 */
export async function getNotificationById(id) {
  const notification = await Repo.findById(id);

  if (!notification) {
    throw ApiError.notFound('Notification');
  }

  return shapeNotification(notification);
}

// ─── Stats ────────────────────────────────────────────────────────────────────

/**
 * getNotificationStats(params)
 * Called by GET /api/super-admin/notifications/stats
 *
 * Returns the three top-level stat card values plus breakdowns.
 *
 * Frontend stat cards:
 *   - "Total Notifications" → stats.total
 *   - "Avg. Delivery Rate"  → (sent / (sent + failed)) * 100, formatted as %
 *   - "Total Failed"        → stats.total_failed
 */
export async function getNotificationStats({ date_range, date_from, date_to }) {
  const raw = await Repo.getStats({
    dateRange: date_range,
    dateFrom:  date_from,
    dateTo:    date_to,
  });

  // Flatten byStatus array → map for easy access
  const statusMap = Object.fromEntries(
    raw.byStatus.map(s => [s.status, s._count._all])
  );

  const total_sent       = statusMap['SENT']       ?? 0;
  const total_failed     = statusMap['FAILED']     ?? 0;
  const total_queued     = statusMap['QUEUED']     ?? 0;
  const total_suppressed = statusMap['SUPPRESSED'] ?? 0;

  // Delivery rate = sent / (sent + failed) — exclude queued/suppressed
  // Return null if no data to avoid NaN/divide-by-zero
  const attempted = total_sent + total_failed;
  const delivery_rate = attempted > 0
    ? parseFloat(((total_sent / attempted) * 100).toFixed(1))
    : null;

  // Per-channel breakdown — flatten for easier frontend consumption
  const by_channel = Object.fromEntries(
    raw.byChannel.map(c => [c.channel, c._count._all])
  );

  // Per-type breakdown — array (top 10, ordered by count desc)
  const by_type = raw.byType.map(t => ({
    type:  t.type,
    count: t._count._all,
  }));

  return {
    total:              raw.total,
    total_sent,
    total_failed,
    total_queued,
    total_suppressed,
    delivery_rate,       // percentage, e.g. 98.7
    by_channel,
    by_type,
  };
}

// ─── Shape Helper ─────────────────────────────────────────────────────────────

/**
 * shapeNotification(raw)
 * Maps raw Prisma row → flat response object.
 *
 * The frontend table columns that map to these fields:
 *   Recipient/Entity → recipient  (+ student/parent sub-fields)
 *   Type             → type
 *   Channel          → channel
 *   Status           → status
 *   Sent At          → sent_at (falls back to created_at)
 *   Error/Payload    → error + payload
 *   (school column)  → school_name / school_id
 */
function shapeNotification(n) {
  return {
    id:           n.id,

    // Recipient display
    recipient:    n.recipient,
    school_id:    n.school?.id   ?? null,
    school_name:  n.school?.name ?? null,
    school_code:  n.school?.code ?? null,

    // Notification details
    type:         n.type,
    event_type:   n.event_type ?? null,
    channel:      n.channel,
    status:       n.status,
    content:      n.content     ?? null,
    subject:      n.subject     ?? null,
    payload:      n.payload     ?? null,
    error:        n.error       ?? null,
    retry_count:  n.retry_count,
    latency_ms:   n.latency_ms  ?? null,
    provider_ref: n.provider_ref ?? null,

    // Timestamps
    sent_at:      n.sent_at     ?? null,
    created_at:   n.created_at,

    // Related entities (nullable)
    student:      n.student
      ? {
          id:         n.student.id,
          name:       [n.student.first_name, n.student.last_name].filter(Boolean).join(' '),
          class:      n.student.class   ?? null,
          section:    n.student.section ?? null,
        }
      : null,

    parent:       n.parent
      ? {
          id:    n.parent.id,
          name:  n.parent.name  ?? null,
          phone: n.parent.phone ?? null,
        }
      : null,
  };
}