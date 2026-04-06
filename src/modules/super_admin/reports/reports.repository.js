// =============================================================================
// reports.repository.js — RESQID Super Admin
// Raw SQL aggregations for analytics — no business logic
//
// All queries accept `months` (int) as the lookback window.
// $queryRaw uses parameterised interpolation — SQL-injection safe.
//
// BigInt safety: PostgreSQL COUNT/SUM may return JS BigInt.
// The normalize() helper converts all BigInt values → Number before
// returning so JSON serialisation never crashes downstream.
// =============================================================================

import { prisma } from '#config/prisma.js';

// ─── BigInt → Number normaliser ───────────────────────────────────────────────
const normalize = rows =>
  rows.map(row =>
    Object.fromEntries(
      Object.entries(row).map(([k, v]) => [
        k,
        typeof v === 'bigint' ? Number(v) : v,
      ])
    )
  );

export const ReportsRepository = {

  // ── Chart data ─────────────────────────────────────────────────────────────

  /**
   * Monthly revenue (SUCCESS payments) for the last `months` months.
   * revenue is returned in paise — service converts to ₹.
   */
  async getMonthlyRevenue(months) {
    const rows = await prisma.$queryRaw`
      SELECT
        TO_CHAR(DATE_TRUNC('month', created_at), 'Mon')  AS month,
        DATE_TRUNC('month', created_at)                  AS month_date,
        COALESCE(SUM(amount), 0)                         AS revenue,
        COUNT(*)::int                                    AS payment_count
      FROM "Payment"
      WHERE status = 'SUCCESS'
        AND created_at >= NOW() - (${months} * INTERVAL '1 month')
      GROUP BY DATE_TRUNC('month', created_at)
      ORDER BY DATE_TRUNC('month', created_at) ASC
    `;
    return normalize(rows);
  },

  /**
   * Monthly QR scan volume for the last `months` months.
   */
  async getMonthlyScanVolume(months) {
    const rows = await prisma.$queryRaw`
      SELECT
        TO_CHAR(DATE_TRUNC('month', created_at), 'Mon')  AS month,
        DATE_TRUNC('month', created_at)                  AS month_date,
        COUNT(*)::int                                    AS scans
      FROM "ScanLog"
      WHERE created_at >= NOW() - (${months} * INTERVAL '1 month')
      GROUP BY DATE_TRUNC('month', created_at)
      ORDER BY DATE_TRUNC('month', created_at) ASC
    `;
    return normalize(rows);
  },

  // ── CSV export data ────────────────────────────────────────────────────────

  /**
   * Revenue report: monthly totals + paying school count.
   */
  async getRevenueExportData(months) {
    const rows = await prisma.$queryRaw`
      SELECT
        TO_CHAR(DATE_TRUNC('month', created_at), 'Mon YYYY') AS period,
        COALESCE(SUM(amount), 0)                             AS total_revenue_paise,
        COUNT(DISTINCT school_id)::int                       AS paying_schools,
        COUNT(*)::int                                        AS payment_count,
        COALESCE(AVG(amount), 0)                             AS avg_payment_paise
      FROM "Payment"
      WHERE status    = 'SUCCESS'
        AND created_at >= NOW() - (${months} * INTERVAL '1 month')
      GROUP BY DATE_TRUNC('month', created_at)
      ORDER BY DATE_TRUNC('month', created_at) ASC
    `;
    return normalize(rows);
  },

  /**
   * School activity: per-school scans + active students + anomalies.
   * Anomaly join goes through Token because ScanAnomaly is on token_id.
   */
  async getSchoolActivityExportData(months) {
    const rows = await prisma.$queryRaw`
      SELECT
        s.name                                         AS school_name,
        COALESCE(s.city,  '')                          AS city,
        COALESCE(s.state, '')                          AS state,
        s.school_type,
        COUNT(DISTINCT sl.id)::int                     AS total_scans,
        COUNT(DISTINCT sl.student_id)::int             AS active_students,
        COUNT(DISTINCT sa.id)::int                     AS anomalies,
        MAX(sl.created_at)                             AS last_scan_at
      FROM "School" s
      LEFT JOIN "ScanLog" sl
        ON sl.school_id = s.id
        AND sl.created_at >= NOW() - (${months} * INTERVAL '1 month')
      LEFT JOIN "Token" t
        ON t.school_id = s.id
      LEFT JOIN "ScanAnomaly" sa
        ON sa.token_id   = t.id
        AND sa.created_at >= NOW() - (${months} * INTERVAL '1 month')
      WHERE s.is_active = true
      GROUP BY s.id, s.name, s.city, s.state, s.school_type
      ORDER BY total_scans DESC
    `;
    return normalize(rows);
  },

  /**
   * Platform growth: new schools + new students per month.
   * Two queries run in parallel — merged in service.
   */
  async getPlatformGrowthExportData(months) {
    const [schools, students] = await Promise.all([
      prisma.$queryRaw`
        SELECT
          TO_CHAR(DATE_TRUNC('month', created_at), 'Mon YYYY') AS period,
          DATE_TRUNC('month', created_at)                      AS sort_key,
          COUNT(*)::int                                        AS new_schools
        FROM "School"
        WHERE created_at >= NOW() - (${months} * INTERVAL '1 month')
        GROUP BY DATE_TRUNC('month', created_at)
        ORDER BY DATE_TRUNC('month', created_at) ASC
      `,
      prisma.$queryRaw`
        SELECT
          TO_CHAR(DATE_TRUNC('month', created_at), 'Mon YYYY') AS period,
          COUNT(*)::int                                        AS new_students
        FROM "Student"
        WHERE created_at >= NOW() - (${months} * INTERVAL '1 month')
        GROUP BY DATE_TRUNC('month', created_at)
        ORDER BY DATE_TRUNC('month', created_at) ASC
      `,
    ]);
    return { schools: normalize(schools), students: normalize(students) };
  },

  /**
   * Subscription cohort: status breakdown by signup month.
   */
  async getSubscriptionCohortExportData(months) {
    const rows = await prisma.$queryRaw`
      SELECT
        TO_CHAR(DATE_TRUNC('month', created_at), 'Mon YYYY')    AS period,
        COUNT(*)::int                                            AS total,
        COUNT(*) FILTER (WHERE status = 'TRIALING')::int        AS trialing,
        COUNT(*) FILTER (WHERE status = 'ACTIVE')::int          AS active,
        COUNT(*) FILTER (WHERE status = 'CANCELED')::int        AS canceled,
        COUNT(*) FILTER (WHERE status = 'PAST_DUE')::int        AS past_due,
        COUNT(*) FILTER (WHERE status = 'EXPIRED')::int         AS expired,
        COUNT(*) FILTER (WHERE is_pilot = true)::int            AS pilot
      FROM "Subscription"
      WHERE created_at >= NOW() - (${months} * INTERVAL '1 month')
      GROUP BY DATE_TRUNC('month', created_at)
      ORDER BY DATE_TRUNC('month', created_at) ASC
    `;
    return normalize(rows);
  },
};