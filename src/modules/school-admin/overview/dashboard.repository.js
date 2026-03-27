// =============================================================================
// modules/dashboard/dashboard.repository.js — RESQID
// Responsibility: ALL Prisma queries for the dashboard. Nothing else.
// No business logic. No caching. No shaping beyond what Prisma returns.
//
// INDEX USAGE (every query documented):
//   Student  → @@index([school_id, is_active])
//   Token    → @@index([school_id, status]), @@index([expires_at])
//   ScanLog  → @@index([school_id, created_at])          [R03 denorm]
//   ScanAnomaly → token.school_id via Token @@index([school_id])
//   ParentEditLog → @@index([school_id]), @@index([field_group])
//   Subscription → @@index([school_id])
// =============================================================================

import { prisma } from '#config/prisma.js';

// ─── Student Counts ───────────────────────────────────────────────────────────

/**
 * getStudentCounts(schoolId)
 * Two COUNT queries in parallel — same index, same table.
 * Returns: { total: number, newThisMonth: number }
 */
export async function getStudentCounts(schoolId) {
  const monthStart = startOfCurrentMonth();

  const [total, newThisMonth] = await Promise.all([
    prisma.student.count({
      where: {
        school_id: schoolId,
        is_active: true,
        deleted_at: null,
      },
    }),
    prisma.student.count({
      where: {
        school_id: schoolId,
        is_active: true,
        deleted_at: null,
        created_at: { gte: monthStart },
      },
    }),
  ]);

  return { total, newThisMonth };
}

// ─── Token Breakdown ──────────────────────────────────────────────────────────

/**
 * getTokenBreakdown(schoolId)
 * One groupBy → all token statuses in a single round trip.
 * One COUNT for expiring tokens (ACTIVE, expires within 30 days).
 * Both run in parallel.
 *
 * Returns: {
 *   breakdown:     [{ status, count }]
 *   activeCount:   number
 *   totalCount:    number
 *   expiringCount: number
 * }
 */
export async function getTokenBreakdown(schoolId) {
  const thirtyDaysOut = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  const [grouped, expiringCount] = await Promise.all([
    prisma.token.groupBy({
      by: ['status'],
      where: { school_id: schoolId },
      _count: { status: true },
    }),
    prisma.token.count({
      where: {
        school_id: schoolId,
        status: 'ACTIVE',
        expires_at: {
          gte: new Date(),
          lte: thirtyDaysOut,
        },
      },
    }),
  ]);

  const breakdown = grouped.map(g => ({
    status: g.status,
    count: g._count.status,
  }));

  const activeCount = breakdown.find(b => b.status === 'ACTIVE')?.count ?? 0;
  const totalCount = breakdown.reduce((sum, b) => sum + b.count, 0);

  return { breakdown, activeCount, totalCount, expiringCount };
}

// ─── Scan Logs (Last 7 Days) ──────────────────────────────────────────────────

/**
 * getScanLogsLast7Days(schoolId)
 * Fetches minimal ScanLog rows for the last 7 days.
 * Uses @@index([school_id, created_at]) — hot path, designed for this query.
 *
 * Only selects { result, created_at } — smallest possible payload.
 * Pivoting into per-day buckets happens in dashboard.service.js.
 *
 * Returns: [{ result: ScanResult, created_at: Date }]
 */
export async function getScanLogsLast7Days(schoolId) {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  return prisma.scanLog.findMany({
    where: {
      school_id: schoolId,
      created_at: { gte: sevenDaysAgo },
    },
    select: {
      result: true,
      created_at: true,
    },
    orderBy: { created_at: 'asc' },
  });
}

// ─── Recent Anomalies ─────────────────────────────────────────────────────────

/**
 * getRecentAnomalies(schoolId)
 * Top 5 unresolved anomalies for this school.
 * ScanAnomaly has no school_id — filters via token.school_id relation.
 * Nested select pulls student name in the same query — no N+1.
 *
 * Returns: [{
 *   id, type, severity, created_at, student_name
 * }]
 */
export async function getRecentAnomalies(schoolId) {
  const rows = await prisma.scanAnomaly.findMany({
    where: {
      resolved: false,
      token: {
        school_id: schoolId,
      },
    },
    select: {
      id: true,
      anomaly_type: true,
      severity: true,
      created_at: true,
      token: {
        select: {
          student: {
            select: {
              first_name: true,
              last_name: true,
            },
          },
        },
      },
    },
    orderBy: { created_at: 'desc' },
    take: 5,
  });

  return rows.map(a => ({
    id: a.id,
    type: a.anomaly_type,
    severity: a.severity,
    created_at: a.created_at,
    student_name: a.token?.student
      ? `${a.token.student.first_name ?? ''} ${a.token.student.last_name ?? ''}`.trim()
      : 'Unknown Student',
  }));
}

// ─── Pending Parent Requests ──────────────────────────────────────────────────

/**
 * getPendingParentRequests(schoolId)
 * Recent CARD_REPLACEMENT and CARD_BLOCK edits from parents — last 30 days.
 * Dashboard shows top 5 for the school admin to review.
 * Nested select: student name + parent name in one query.
 *
 * Returns: [{
 *   id, type, student_name, parent_name, created_at
 * }]
 */
export async function getPendingParentRequests(schoolId) {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const rows = await prisma.parentEditLog.findMany({
    where: {
      school_id: schoolId,
      field_group: { in: ['CARD_REPLACEMENT', 'CARD_BLOCK'] },
      created_at: { gte: thirtyDaysAgo },
    },
    select: {
      id: true,
      field_group: true,
      created_at: true,
      student: {
        select: {
          first_name: true,
          last_name: true,
        },
      },
      parent: {
        select: { name: true },
      },
    },
    orderBy: { created_at: 'desc' },
    take: 5,
  });

  return rows.map(r => ({
    id: r.id,
    type: r.field_group,
    created_at: r.created_at,
    student_name: r.student
      ? `${r.student.first_name ?? ''} ${r.student.last_name ?? ''}`.trim()
      : 'Unknown Student',
    parent_name: r.parent?.name ?? 'Unknown Parent',
  }));
}

// ─── Subscription ─────────────────────────────────────────────────────────────

/**
 * getSubscription(schoolId)
 * Latest subscription for this school.
 * Selects only the fields the dashboard needs.
 *
 * Returns: { status, plan, current_period_end, trial_ends_at } | null
 */
export async function getSubscription(schoolId) {
  return prisma.subscription.findFirst({
    where: { school_id: schoolId },
    select: {
      status: true,
      plan: true,
      current_period_end: true,
      trial_ends_at: true,
    },
    orderBy: { created_at: 'desc' },
  });
}

// ─── Date Helper ─────────────────────────────────────────────────────────────

function startOfCurrentMonth() {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}
