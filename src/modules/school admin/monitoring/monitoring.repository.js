// =============================================================================
// monitoring.repository.js — RESQID School Admin › Scan Monitoring
// Pure Prisma data access — zero business logic, zero ApiErrors
// All functions return data or null — service layer decides what to do
// =============================================================================

import { prisma } from "../../../config/prisma.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Return start/end of today in server-local time */
const todayBounds = () => {
  const now   = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end   = new Date(start.getTime() + 86_400_000);
  return { start, end };
};

// ─── ─── Stats / KPIs ─────────────────────────────────────────────────────────

/**
 * getScanStats — 15 parallel Prisma queries, one Promise.all
 * Returns every KPI the overview dashboard needs.
 */
export const getScanStats = async (schoolId) => {
  const { start: todayStart, end: todayEnd } = todayBounds();
  const yesterdayStart = new Date(todayStart.getTime() - 86_400_000);
  const weekStart      = new Date(todayStart.getTime() - 6 * 86_400_000);

  // Shared filter shortcuts
  const bySchool = { token: { school_id: schoolId } };
  const today    = { ...bySchool, created_at: { gte: todayStart, lt: todayEnd } };
  const yest     = { ...bySchool, created_at: { gte: yesterdayStart, lt: todayStart } };

  const [
    totalToday,
    successToday,
    invalidToday,
    revokedToday,
    expiredToday,
    rateLimitedToday,
    errorToday,
    inactiveToday,
    knownToday,       // token linked to a student
    unknownToday,     // token has NO student
    totalYesterday,
    totalWeek,
    unresolvedAnomalies,
    criticalAnomalies,
    pendingNotifications,
  ] = await Promise.all([
    prisma.scanLog.count({ where: today }),
    prisma.scanLog.count({ where: { ...today, result: "SUCCESS" } }),
    prisma.scanLog.count({ where: { ...today, result: "INVALID" } }),
    prisma.scanLog.count({ where: { ...today, result: "REVOKED" } }),
    prisma.scanLog.count({ where: { ...today, result: "EXPIRED" } }),
    prisma.scanLog.count({ where: { ...today, result: "RATE_LIMITED" } }),
    prisma.scanLog.count({ where: { ...today, result: "ERROR" } }),
    prisma.scanLog.count({ where: { ...today, result: "INACTIVE" } }),
    // known = token.student_id IS NOT NULL
    prisma.scanLog.count({
      where: { ...today, token: { school_id: schoolId, student_id: { not: null } } },
    }),
    // unknown = token.student_id IS NULL
    prisma.scanLog.count({
      where: { ...today, token: { school_id: schoolId, student_id: null } },
    }),
    prisma.scanLog.count({ where: yest }),
    prisma.scanLog.count({ where: { ...bySchool, created_at: { gte: weekStart } } }),
    prisma.scanAnomaly.count({ where: { token: { school_id: schoolId }, resolved: false } }),
    prisma.scanAnomaly.count({
      where: { token: { school_id: schoolId }, resolved: false, severity: "CRITICAL" },
    }),
    prisma.notification.count({
      where: {
        school_id: schoolId,
        status:    "QUEUED",
        type:      { in: ["SCAN_ALERT", "SCAN_ANOMALY", "CARD_REVOKED", "DEVICE_LOGIN"] },
      },
    }),
  ]);

  const failedToday = invalidToday + revokedToday + expiredToday + rateLimitedToday + errorToday + inactiveToday;
  const successRate = totalToday > 0 ? Math.round((successToday / totalToday) * 100) : 0;
  const trendPct    = totalYesterday > 0
    ? Math.round(((totalToday - totalYesterday) / totalYesterday) * 100)
    : null;

  return {
    today: {
      total:       totalToday,
      success:     successToday,
      failed:      failedToday,
      successRate,
      // per-result breakdown
      invalid:    invalidToday,
      revoked:    revokedToday,
      expired:    expiredToday,
      rateLimited: rateLimitedToday,
      error:      errorToday,
      inactive:   inactiveToday,
      // student identity
      known:   knownToday,
      unknown: unknownToday,
    },
    trend: {
      yesterday: totalYesterday,
      week:      totalWeek,
      pct:       trendPct,
      direction: trendPct === null ? null : trendPct >= 0 ? "up" : "down",
    },
    anomalies: {
      unresolved: unresolvedAnomalies,
      critical:   criticalAnomalies,
    },
    notifications: {
      pending: pendingNotifications,
    },
  };
};

/**
 * getScanTrend — 7-day daily success vs failed for the area chart
 */
export const getScanTrend = async (schoolId) => {
  const rows = [];
  for (let i = 6; i >= 0; i--) {
    const d     = new Date();
    d.setDate(d.getDate() - i);
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const end   = new Date(start.getTime() + 86_400_000);
    const base  = { token: { school_id: schoolId }, created_at: { gte: start, lt: end } };

    const [success, failed] = await Promise.all([
      prisma.scanLog.count({ where: { ...base, result: "SUCCESS" } }),
      prisma.scanLog.count({ where: { ...base, result: { not: "SUCCESS" } } }),
    ]);

    rows.push({
      date:    start.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }),
      success,
      failed,
      total:   success + failed,
    });
  }
  return rows;
};

/**
 * getResultBreakdown — today's per-result counts for the donut chart
 */
export const getResultBreakdown = async (schoolId) => {
  const { start, end } = todayBounds();
  const results = ["SUCCESS", "INVALID", "REVOKED", "EXPIRED", "INACTIVE", "RATE_LIMITED", "ERROR"];

  const rows = await Promise.all(
    results.map(async (result) => ({
      result,
      count: await prisma.scanLog.count({
        where: { token: { school_id: schoolId }, result, created_at: { gte: start, lt: end } },
      }),
    })),
  );

  return rows.filter((r) => r.count > 0);
};

// ─── Scan Logs ────────────────────────────────────────────────────────────────

export const listScanLogs = async (
  schoolId,
  { page, limit, sortDir, result, student_known, token_id, student_id, from, to },
) => {
  const skip = (page - 1) * limit;

  const tokenFilter = {
    school_id: schoolId,
    ...(student_id && { student_id }),
    ...(student_known === true  && { student_id: { not: null } }),
    ...(student_known === false && { student_id: null }),
  };

  const where = {
    token: tokenFilter,
    ...(result   && { result }),
    ...(token_id && { token_id }),
    ...((from || to) && {
      created_at: {
        ...(from && { gte: new Date(from) }),
        ...(to   && { lte: new Date(to) }),
      },
    }),
  };

  const [total, items] = await Promise.all([
    prisma.scanLog.count({ where }),
    prisma.scanLog.findMany({
      where,
      skip,
      take:    limit,
      orderBy: { created_at: sortDir },
      select: {
        id:               true,
        result:           true,
        ip_address:       true,
        ip_city:          true,
        ip_country:       true,
        ip_region:        true,
        latitude:         true,
        longitude:        true,
        device_hash:      true,
        user_agent:       true,
        scan_purpose:     true,
        response_time_ms: true,
        created_at:       true,
        token: {
          select: {
            id:     true,
            status: true,
            student: {
              select: {
                id:         true,
                first_name: true,
                last_name:  true,
                class:      true,
                section:    true,
                photo_url:  true,
              },
            },
          },
        },
      },
    }),
  ]);

  return { total, items };
};

export const findScanLogById = async (schoolId, id) =>
  prisma.scanLog.findFirst({
    where: { id, token: { school_id: schoolId } },
    include: {
      token: {
        include: {
          student:   true,
          anomalies: {
            where:   { resolved: false },
            orderBy: { created_at: "desc" },
            take:    5,
          },
        },
      },
    },
  });

// ─── Anomalies ────────────────────────────────────────────────────────────────

export const listAnomalies = async (
  schoolId,
  { page, limit, sortDir, severity, type, resolved, from, to },
) => {
  const skip  = (page - 1) * limit;
  const where = {
    token: { school_id: schoolId },
    ...(severity !== undefined && { severity }),
    ...(type     !== undefined && { anomaly_type: type }),
    ...(resolved !== undefined && { resolved }),
    ...((from || to) && {
      created_at: {
        ...(from && { gte: new Date(from) }),
        ...(to   && { lte: new Date(to) }),
      },
    }),
  };

  const [total, items] = await Promise.all([
    prisma.scanAnomaly.count({ where }),
    prisma.scanAnomaly.findMany({
      where,
      skip,
      take:    limit,
      orderBy: { created_at: sortDir },
      select: {
        id:           true,
        anomaly_type: true,
        severity:     true,
        reason:       true,
        metadata:     true,
        resolved:     true,
        resolved_at:  true,
        resolved_by:  true,
        created_at:   true,
        token: {
          select: {
            id:     true,
            status: true,
            student: {
              select: {
                id:         true,
                first_name: true,
                last_name:  true,
                class:      true,
                section:    true,
                photo_url:  true,
              },
            },
          },
        },
      },
    }),
  ]);

  return { total, items };
};

export const findAnomalyById = async (schoolId, id) =>
  prisma.scanAnomaly.findFirst({
    where:   { id, token: { school_id: schoolId } },
    include: { token: { include: { student: true } } },
  });

export const markAnomalyResolved = async (id, resolvedBy, notes) =>
  prisma.scanAnomaly.update({
    where: { id },
    data: {
      resolved:    true,
      resolved_at: new Date(),
      resolved_by: resolvedBy,
      ...(notes && { reason: notes }),
    },
  });

// ─── Multi-Device ─────────────────────────────────────────────────────────────

/**
 * Tokens scanned from >= min_devices distinct device_hashes.
 * Prisma groupBy doesn't support HAVING so we group + post-filter in JS.
 */
export const getMultiDeviceScans = async (
  schoolId,
  { page, limit, min_devices, from, to },
) => {
  const skip       = (page - 1) * limit;
  const dateFilter = (from || to)
    ? { created_at: { ...(from && { gte: new Date(from) }), ...(to && { lte: new Date(to) }) } }
    : {};

  // 1. All token_ids for this school that have device_hash set
  const grouped = await prisma.scanLog.groupBy({
    by:      ["token_id"],
    where:   { token: { school_id: schoolId }, device_hash: { not: null }, ...dateFilter },
    _count:  { device_hash: true },
    orderBy: { _count: { device_hash: "desc" } },
  });

  // 2. Per token — count distinct device_hashes (groupBy counts rows, not distinct)
  const enriched = await Promise.all(
    grouped.map(async ({ token_id }) => {
      const scans = await prisma.scanLog.findMany({
        where:  { token_id, device_hash: { not: null }, ...dateFilter },
        select: { device_hash: true, created_at: true, ip_city: true, ip_country: true },
      });

      const uniqueDevices = [...new Set(scans.map((s) => s.device_hash))];
      const latest        = [...scans].sort(
        (a, b) => new Date(b.created_at) - new Date(a.created_at),
      )[0];

      return {
        token_id,
        device_count:   uniqueDevices.length,
        total_scans:    scans.length,
        latest_scan_at: latest?.created_at ?? null,
      };
    }),
  );

  // 3. Filter by threshold
  const filtered  = enriched.filter((e) => e.device_count >= min_devices);
  const total     = filtered.length;
  const pageSlice = filtered.slice(skip, skip + limit);

  // 4. Hydrate with token + student
  const items = await Promise.all(
    pageSlice.map(async (item) => {
      const token = await prisma.token.findFirst({
        where: { id: item.token_id, school_id: schoolId },
        select: {
          id:     true,
          status: true,
          student: {
            select: {
              id:         true,
              first_name: true,
              last_name:  true,
              class:      true,
              section:    true,
              photo_url:  true,
            },
          },
        },
      });
      return { ...item, token };
    }),
  );

  return { total, items };
};

// ─── Notifications ────────────────────────────────────────────────────────────

export const listNotifications = async (
  schoolId,
  { page, limit, type, status, from, to },
) => {
  const skip  = (page - 1) * limit;

  // Default scope: scan-related types only
  const typeFilter = type
    ? { type }
    : { type: { in: ["SCAN_ALERT", "SCAN_ANOMALY", "CARD_REVOKED", "CARD_REPLACED", "DEVICE_LOGIN"] } };

  const where = {
    school_id: schoolId,
    ...typeFilter,
    ...(status && { status }),
    ...((from || to) && {
      created_at: {
        ...(from && { gte: new Date(from) }),
        ...(to   && { lte: new Date(to) }),
      },
    }),
  };

  const [total, items] = await Promise.all([
    prisma.notification.count({ where }),
    prisma.notification.findMany({
      where,
      skip,
      take:    limit,
      orderBy: { created_at: "desc" },
      select: {
        id:          true,
        type:        true,
        channel:     true,
        status:      true,
        payload:     true,
        retry_count: true,
        sent_at:     true,
        error:       true,
        created_at:  true,
        student: {
          select: { id: true, first_name: true, last_name: true, photo_url: true },
        },
        parent: {
          select: { id: true, name: true, phone: true },
        },
      },
    }),
  ]);

  return { total, items };
};

export const getUnreadCount = async (schoolId) =>
  prisma.notification.count({
    where: {
      school_id: schoolId,
      status:    "QUEUED",
      type:      { in: ["SCAN_ALERT", "SCAN_ANOMALY", "CARD_REVOKED", "DEVICE_LOGIN"] },
    },
  });