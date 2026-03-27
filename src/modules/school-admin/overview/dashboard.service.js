// =============================================================================
// modules/dashboard/dashboard.service.js — RESQID
// Responsibility: orchestration, caching, data shaping.
// NO Prisma calls here — all DB access goes through dashboard.repository.js
// =============================================================================

import { cacheAside, cacheDel } from '#utils/cache/cache.js';
import * as repo from './dashboard.repository.js';

// ─── Cache Config ─────────────────────────────────────────────────────────────
// TTL: 2 minutes — dashboard is a summary view, slight staleness is fine.
// On a school refreshing 10x/day, this reduces DB hits from 10 → 1 per 2min window.
const DASHBOARD_KEY = schoolId => `dashboard:${schoolId}`;
const DASHBOARD_TTL = 2 * 60; // 120 seconds

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * getDashboardData(schoolId)
 * Tries Redis first. On miss → fetches from DB via repository → caches result.
 */
export async function getDashboardData(schoolId) {
  return cacheAside(DASHBOARD_KEY(schoolId), DASHBOARD_TTL, () => buildDashboard(schoolId));
}

/**
 * invalidateDashboard(schoolId)
 * Call this from any service that writes dashboard-relevant data:
 *   - student created / deleted
 *   - token status changed
 *   - anomaly resolved
 *   - parent request actioned
 *   - subscription updated
 */
export async function invalidateDashboard(schoolId) {
  await cacheDel(DASHBOARD_KEY(schoolId));
}

// ─── Private: Orchestration ───────────────────────────────────────────────────

/**
 * buildDashboard(schoolId)
 * Runs all repository queries in parallel, shapes the final payload.
 * Called only on cache miss.
 */
async function buildDashboard(schoolId) {
  // All 6 repository calls run in parallel — none depend on each other
  const [studentCounts, tokenData, scanRaw, recentAnomalies, pendingRequests, subscription] =
    await Promise.all([
      repo.getStudentCounts(schoolId),
      repo.getTokenBreakdown(schoolId),
      repo.getScanLogsLast7Days(schoolId),
      repo.getRecentAnomalies(schoolId),
      repo.getPendingParentRequests(schoolId),
      repo.getSubscription(schoolId),
    ]);

  // ── Scan trend: pivot raw rows into per-day buckets ────────────────────────
  const { scanTrend, todayScans, scanTrendUp, scanChangePercent } = buildScanTrend(scanRaw);

  return {
    stats: {
      totalStudents: studentCounts.total,
      newStudentsThisMonth: studentCounts.newThisMonth,
      activeTokens: tokenData.activeCount,
      totalTokens: tokenData.totalCount,
      expiringTokens: tokenData.expiringCount,
      todayScans,
      scanTrendUp,
      scanChangePercent,
    },
    scanTrend,
    tokenBreakdown: tokenData.breakdown,
    recentAnomalies,
    pendingRequests,
    subscription,
  };
}

// ─── Private: Scan Pivot ──────────────────────────────────────────────────────

/**
 * buildScanTrend(rawScans)
 * Pivots flat ScanLog rows into a 7-day chart array.
 * Derives today's count, trend direction, and % change — no extra DB call needed.
 *
 * Input:  [{ result: 'SUCCESS'|..., created_at: Date }]
 * Output: {
 *   scanTrend:        [{ date, success, failed }]  ← ordered oldest→newest
 *   todayScans:       number
 *   scanTrendUp:      boolean | null
 *   scanChangePercent: number | null
 * }
 */
function buildScanTrend(rawScans) {
  // Build a map: '14 Mar' → { date, success, failed }
  const dayMap = new Map();

  for (const scan of rawScans) {
    const key = toDayLabel(scan.created_at);
    if (!dayMap.has(key)) {
      dayMap.set(key, { date: key, success: 0, failed: 0 });
    }
    const entry = dayMap.get(key);
    if (scan.result === 'SUCCESS') {
      entry.success += 1;
    } else {
      entry.failed += 1;
    }
  }

  // Fill all 7 days — ensures chart always has 7 bars even on zero-scan days
  const scanTrend = buildDayLabels(7).map(
    key => dayMap.get(key) ?? { date: key, success: 0, failed: 0 }
  );

  // Today and yesterday derived from the same in-memory map — zero extra queries
  const todayKey = toDayLabel(new Date());
  const yesterdayKey = toDayLabel(daysAgo(1));

  const todayEntry = dayMap.get(todayKey) ?? { success: 0, failed: 0 };
  const yesterdayEntry = dayMap.get(yesterdayKey) ?? { success: 0, failed: 0 };

  const todayScans = todayEntry.success + todayEntry.failed;
  const yesterdayTotal = yesterdayEntry.success + yesterdayEntry.failed;

  let scanTrendUp = null;
  let scanChangePercent = null;

  if (yesterdayTotal > 0) {
    const delta = todayScans - yesterdayTotal;
    scanTrendUp = delta >= 0;
    scanChangePercent = Math.round(Math.abs((delta / yesterdayTotal) * 100));
  } else if (todayScans > 0) {
    scanTrendUp = true;
    scanChangePercent = 100;
  }

  return { scanTrend, todayScans, scanTrendUp, scanChangePercent };
}

// ─── Date Helpers ─────────────────────────────────────────────────────────────

function daysAgo(n) {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

/** '14 Mar' — IST locale, used as both map key and chart x-axis label */
function toDayLabel(date) {
  return new Date(date).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    timeZone: 'Asia/Kolkata',
  });
}

/** Returns ordered array of day labels: [oldest, ..., today] */
function buildDayLabels(n) {
  return Array.from({ length: n }, (_, i) => toDayLabel(daysAgo(n - 1 - i)));
}
