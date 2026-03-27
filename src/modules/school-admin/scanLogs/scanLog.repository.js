// =============================================================================
// modules/school_admin/scan_logs/scanlog.repository.js — RESQID
// ALL Prisma calls for scan log inventory. Nothing else.
//
// PERFORMANCE STRATEGY
// ─────────────────────────────────────────────────────────────────────────────
// Two parallel query groups:
//
//   GROUP A (always runs together via Promise.all):
//     Q1: ScanLog.findMany  — paginated rows (skip/take)
//     Q2: ScanLog.count     — total for current filter (pagination meta)
//
//   GROUP B (stats bar — parallel with GROUP A, cached in service layer):
//     Q3: ScanLog.groupBy(result)  — all result counts in ONE query
//         Avoids 6 separate COUNT queries for the stats bar
//     Q4: ScanLog.aggregate(_avg response_time_ms) — single pass avg
//         Avoids a second scan of the table
//
// SEARCH STRATEGY:
//   token_hash search → ILIKE startsWith on Token.token_hash (indexed prefix)
//   student search    → nested OR on Student first_name/last_name
//   ip_city search    → ILIKE contains on ScanLog.ip_city (stored field)
//   All in a single OR block — one query, no N+1
//
// INDEXES USED (from schema):
//   ScanLog → @@index([school_id, created_at])  — base filter + sort HOT PATH
//   ScanLog → @@index([school_id, result])       — result filter hot path
//   ScanLog → @@index([result, created_at])      — result + date range
//   ScanLog → @@index([token_id])                — token join
//   Token   → @@index([school_id])               — token → school guard
// =============================================================================

import { prisma } from '#config/prisma.js';

/**
 * findScanLogs({ schoolId, result, search, from, to, skip, take })
 * Returns: { logs, total }
 */
export async function findScanLogs({ schoolId, result, search, from, to, skip, take }) {
  const where = buildWhere({ schoolId, result, search, from, to });

  const [rows, total] = await Promise.all([
    prisma.scanLog.findMany({
      where,
      orderBy: { created_at: 'desc' },
      skip,
      take,
      select: {
        id: true,
        result: true,
        ip_address: true,
        ip_city: true,
        ip_country: true,
        user_agent: true,
        scan_purpose: true,
        response_time_ms: true,
        created_at: true,

        // Token hash — masked in frontend via maskTokenHash()
        token: {
          select: {
            token_hash: true,
            // Student name through token relation
            student: {
              select: {
                first_name: true,
                last_name: true,
              },
            },
          },
        },
      },
    }),

    prisma.scanLog.count({ where }),
  ]);

  const logs = rows.map(shapeLog);
  return { logs, total };
}

/**
 * getScanLogStats({ schoolId, from, to })
 *
 * TWO queries, both run in parallel:
 *   Q1: groupBy(result)          → count per result bucket
 *   Q2: aggregate(_avg, _count)  → avgResponseTime + total
 *
 * Cached in service layer — stats don't change per filter/search/page.
 * Date range is part of the cache key so "today" vs 'all time' are separate.
 *
 * Returns: { total, SUCCESS, INVALID, REVOKED, EXPIRED, INACTIVE, RATE_LIMITED, ERROR, avgResponseMs }
 */
export async function getScanLogStats({ schoolId, from, to }) {
  // Base where — scoped to school + optional date window
  const statsWhere = buildStatsWhere({ schoolId, from, to });

  const [grouped, agg] = await Promise.all([
    prisma.scanLog.groupBy({
      by: ['result'],
      where: statsWhere,
      _count: { result: true },
    }),

    prisma.scanLog.aggregate({
      where: statsWhere,
      _avg: { response_time_ms: true },
      _count: { id: true },
    }),
  ]);

  // Build stats object with safe defaults for any missing result bucket
  const stats = {
    SUCCESS: 0,
    INVALID: 0,
    REVOKED: 0,
    EXPIRED: 0,
    INACTIVE: 0,
    RATE_LIMITED: 0,
    ERROR: 0,
  };

  for (const g of grouped) {
    stats[g.result] = g._count.result;
  }

  const total = agg._count.id;
  const failed =
    stats.INVALID +
    stats.REVOKED +
    stats.EXPIRED +
    stats.INACTIVE +
    stats.RATE_LIMITED +
    stats.ERROR;

  return {
    ...stats,
    total,
    failed,
    // Round to nearest ms, null if no scans yet
    avgResponseMs: agg._avg.response_time_ms ? Math.round(agg._avg.response_time_ms) : null,
  };
}

// ─── WHERE Builders ───────────────────────────────────────────────────────────

function buildWhere({ schoolId, result, search, from, to }) {
  const where = {
    school_id: schoolId,
    ...(result && result !== 'ALL' && { result }),
    ...buildDateRange(from, to),
  };

  if (!search) return where;

  // Three-way OR:
  //   1. ip_city contains search (stored on ScanLog — no join)
  //   2. Token.token_hash startsWith search (indexed prefix match)
  //   3. Student first_name / last_name contains search (nested via token)
  where.OR = [
    { ip_city: { contains: search, mode: 'insensitive' } },
    {
      token: {
        token_hash: { startsWith: search, mode: 'insensitive' },
      },
    },
    {
      token: {
        student: {
          OR: [
            { first_name: { contains: search, mode: 'insensitive' } },
            { last_name: { contains: search, mode: 'insensitive' } },
          ],
        },
      },
    },
  ];

  return where;
}

// Stats where — no search/pagination, just school + date
function buildStatsWhere({ schoolId, from, to }) {
  return {
    school_id: schoolId,
    ...buildDateRange(from, to),
  };
}

function buildDateRange(from, to) {
  if (!from && !to) return {};
  const range = {};
  if (from) range.gte = from;
  if (to) range.lte = to;
  return { created_at: range };
}

// ─── Shape ────────────────────────────────────────────────────────────────────

function shapeLog(log) {
  // Parse device from user_agent string — e.g. 'Mozilla/5.0 (Android …) Chrome/…'
  const { browser, platform } = parseUserAgent(log.user_agent);

  return {
    id: log.id,
    token_hash: log.token?.token_hash ?? null,
    result: log.result,
    student_name: log.token?.student
      ? `${log.token.student.first_name ?? ''} ${log.token.student.last_name ?? ''}`.trim() || null
      : null,
    ip_address: log.ip_address,
    ip_city: log.ip_city,
    ip_country: log.ip_country,
    // "Chrome/Android" format — matches what frontend splits on '/'
    device: browser && platform ? `${browser}/${platform}` : null,
    scan_purpose: log.scan_purpose,
    response_time_ms: log.response_time_ms,
    created_at: log.created_at,
  };
}

/**
 * Lightweight UA parser — no external dependency.
 * Returns { browser, platform } for display only.
 * Not a forensic UA parser — just enough for the ScanLogs table.
 */
function parseUserAgent(ua) {
  if (!ua) return { browser: null, platform: null };

  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Firefox\//.test(ua)
          ? 'Firefox'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'Browser';

  const platform = /Android/.test(ua)
    ? 'Android'
    : /iPhone|iPad/.test(ua)
      ? 'iOS'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Linux/.test(ua)
          ? 'Linux'
          : /Mac/.test(ua)
            ? 'macOS'
            : 'Unknown';

  return { browser, platform };
}
