// =============================================================================
// notification.repository.js — RESQID Super Admin
// Pure DB layer — only Prisma queries, zero business logic
// =============================================================================

import { prisma } from '#config/prisma.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * buildDateFilter(dateRange, dateFrom, dateTo)
 * Converts a date_range enum + optional custom dates into a Prisma
 * `created_at` filter object.
 */
function buildDateFilter(dateRange, dateFrom, dateTo) {
  const now = new Date();

  switch (dateRange) {
    case '24h':
      return { gte: new Date(now - 24 * 60 * 60 * 1000) };

    case '7d':
      return { gte: new Date(now - 7 * 24 * 60 * 60 * 1000) };

    case '30d':
      return { gte: new Date(now - 30 * 24 * 60 * 60 * 1000) };

    case 'this_month': {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      return { gte: start };
    }

    case 'custom':
      return {
        gte: dateFrom,
        lte: dateTo,
      };

    default:
      // Default: last 30 days (matches frontend default "Last 30 Days")
      return { gte: new Date(now - 30 * 24 * 60 * 60 * 1000) };
  }
}

/**
 * buildWhere(filters)
 * Central where-clause builder reused by both list and count queries.
 */
function buildWhere({ school_id, type, channel, status, dateRange, dateFrom, dateTo }) {
  const where = {};

  if (school_id)  where.school_id = school_id;
  if (type)       where.type      = type;
  if (channel)    where.channel   = channel;
  if (status)     where.status    = status;

  const dateFilter = buildDateFilter(dateRange, dateFrom, dateTo);
  if (dateFilter) where.created_at = dateFilter;

  return where;
}

// ─── Select Shape ─────────────────────────────────────────────────────────────
// Used for list and single-notification queries.
// Returns everything the frontend needs — no over-fetching.

const NOTIFICATION_SELECT = {
  id:           true,
  type:         true,
  channel:      true,
  status:       true,
  recipient:    true,
  content:      true,
  subject:      true,
  payload:      true,
  error:        true,
  retry_count:  true,
  latency_ms:   true,
  provider_ref: true,
  event_type:   true,
  sent_at:      true,
  created_at:   true,

  // School name for the "School" column in the frontend table
  school: {
    select: {
      id:   true,
      name: true,
      code: true,
    },
  },

  // Student info (nullable) — recipient may be a student
  student: {
    select: {
      id:         true,
      first_name: true,
      last_name:  true,
      class:      true,
      section:    true,
    },
  },

  // Parent info (nullable)
  parent: {
    select: {
      id:    true,
      name:  true,
      phone: true,
    },
  },
};

// ─── Repository ───────────────────────────────────────────────────────────────

/**
 * findMany({ filters, skip, take })
 * Returns paginated list of notifications with school + student + parent joins.
 */
export async function findMany({ filters, skip, take }) {
  const where = buildWhere(filters);

  const [notifications, total] = await Promise.all([
    prisma.notification.findMany({
      where,
      select: NOTIFICATION_SELECT,
      orderBy: { created_at: 'desc' },
      skip,
      take,
    }),
    prisma.notification.count({ where }),
  ]);

  return { notifications, total };
}

/**
 * findById(id)
 * Returns a single notification by ID (for the payload modal / detail view).
 */
export async function findById(id) {
  return prisma.notification.findUnique({
    where:  { id },
    select: NOTIFICATION_SELECT,
  });
}

/**
 * getStats({ dateRange, dateFrom, dateTo })
 * Returns aggregate counts used by the three stat cards:
 *   - total            → "Total Notifications"
 *   - total_sent       → used to compute delivery rate
 *   - total_failed     → "Total Failed"
 *   - total_queued
 *   - total_suppressed
 *
 * Also returns per-channel and per-type breakdowns
 * (useful for future chart widgets).
 */
export async function getStats({ dateRange, dateFrom, dateTo }) {
  const dateFilter = buildDateFilter(dateRange, dateFrom, dateTo);
  const baseWhere  = dateFilter ? { created_at: dateFilter } : {};

  const [
    total,
    byStatus,
    byChannel,
    byType,
  ] = await Promise.all([
    // Total
    prisma.notification.count({ where: baseWhere }),

    // Group by status
    prisma.notification.groupBy({
      by:     ['status'],
      where:  baseWhere,
      _count: { _all: true },
    }),

    // Group by channel
    prisma.notification.groupBy({
      by:     ['channel'],
      where:  baseWhere,
      _count: { _all: true },
    }),

    // Group by type — top N event types
    prisma.notification.groupBy({
      by:      ['type'],
      where:   baseWhere,
      _count:  { _all: true },
      orderBy: { _count: { type: 'desc' } },
      take:    10,
    }),
  ]);

  return { total, byStatus, byChannel, byType };
}