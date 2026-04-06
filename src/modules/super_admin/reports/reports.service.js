// =============================================================================
// reports.service.js — RESQID Super Admin
// Business logic: data transformation + CSV generation
// =============================================================================

import { ReportsRepository } from './reports.repository.js';

const PAISE = 100;
const paisToRs = p => Math.round(Number(p) / PAISE);

// ─── CSV builder ─────────────────────────────────────────────────────────────
/**
 * Builds a CSV string from a column definition and array of rows.
 * @param {Array<{ label: string, key?: string, fn?: (row) => any }>} columns
 * @param {object[]} rows
 */
function toCSV(columns, rows) {
  const escape = val => {
    if (val == null) return '';
    const s = String(val);
    // Wrap in quotes if value contains comma, quote, or newline
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };

  const headerLine = columns.map(c => c.label).join(',');
  const dataLines  = rows.map(row =>
    columns
      .map(c => escape(c.fn ? c.fn(row) : row[c.key]))
      .join(',')
  );

  return [headerLine, ...dataLines].join('\n');
}

// ─── Service ─────────────────────────────────────────────────────────────────
export const ReportsService = {

  // ── Chart endpoints ─────────────────────────────────────────────────────────

  async getMonthlyRevenue(months) {
    const rows = await ReportsRepository.getMonthlyRevenue(months);
    // Convert paise → ₹ for chart display
    return rows.map(r => ({
      month:         r.month,
      revenue:       paisToRs(r.revenue),
      payment_count: r.payment_count,
    }));
  },

  async getMonthlyScanVolume(months) {
    const rows = await ReportsRepository.getMonthlyScanVolume(months);
    return rows.map(r => ({
      month: r.month,
      scans: r.scans,
    }));
  },

  // ── CSV export builders ──────────────────────────────────────────────────────

  async buildRevenueCSV(months) {
    const rows = await ReportsRepository.getRevenueExportData(months);
    const columns = [
      { label: 'Period',                    key: 'period' },
      { label: 'Total Revenue (₹)',         fn:  r => paisToRs(r.total_revenue_paise) },
      { label: 'Paying Schools',            key: 'paying_schools' },
      { label: 'Payments Recorded',         key: 'payment_count' },
      { label: 'Avg Payment (₹)',           fn:  r => paisToRs(r.avg_payment_paise) },
    ];
    return toCSV(columns, rows);
  },

  async buildSchoolActivityCSV(months) {
    const rows = await ReportsRepository.getSchoolActivityExportData(months);
    const columns = [
      { label: 'School Name',    key: 'school_name' },
      { label: 'City',           key: 'city' },
      { label: 'State',          key: 'state' },
      { label: 'Type',           key: 'school_type' },
      { label: 'Total Scans',    key: 'total_scans' },
      { label: 'Active Students',key: 'active_students' },
      { label: 'Anomalies',      key: 'anomalies' },
      {
        label: 'Last Scan At',
        fn: r => r.last_scan_at ? new Date(r.last_scan_at).toISOString() : '',
      },
    ];
    return toCSV(columns, rows);
  },

  async buildPlatformGrowthCSV(months) {
    const { schools, students } = await ReportsRepository.getPlatformGrowthExportData(months);

    // Merge student counts into school rows by period label
    const studentMap = Object.fromEntries(students.map(s => [s.period, s.new_students]));
    const merged = schools.map(s => ({
      period:       s.period,
      new_schools:  s.new_schools,
      new_students: studentMap[s.period] ?? 0,
    }));

    const columns = [
      { label: 'Period',       key: 'period' },
      { label: 'New Schools',  key: 'new_schools' },
      { label: 'New Students', key: 'new_students' },
    ];
    return toCSV(columns, merged);
  },

  async buildSubscriptionCohortCSV(months) {
    const rows = await ReportsRepository.getSubscriptionCohortExportData(months);
    const columns = [
      { label: 'Period',              key: 'period' },
      { label: 'Total',               key: 'total' },
      { label: 'Trialing',            key: 'trialing' },
      { label: 'Active',              key: 'active' },
      { label: 'Canceled',            key: 'canceled' },
      { label: 'Past Due',            key: 'past_due' },
      { label: 'Expired',             key: 'expired' },
      { label: 'Pilot',               key: 'pilot' },
      {
        label: 'Conversion Rate (%)',
        fn: r => r.total > 0 ? Math.round((r.active / r.total) * 100) : 0,
      },
    ];
    return toCSV(columns, rows);
  },
};