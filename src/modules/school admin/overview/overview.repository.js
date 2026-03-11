// =============================================================================
// monitoring.repository.js — RESQID School Admin
// Raw Prisma queries only — zero business logic
// =============================================================================

import { prisma } from "../../config/prisma.js";

// ─── KPI Stats ────────────────────────────────────────────────────────────────

/**
 * All dashboard KPI numbers in one parallel round-trip
 */
export const getMonitoringStats = async (schoolId) => {
  const now            = new Date();
  const todayStart     = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd       = new Date(todayStart.getTime() + 86_400_000);
  const yesterdayStart = new Date(todayStart.getTime() - 86_400_000);
  const weekStart      = new Date(todayStart.getTime() - 7 * 86_400_000);
  const monthStart     = new Date(now.getFullYear(), now.getMonth(), 1);
  const in30Days       = new Date(todayStart.getTime() + 30 * 86_400_000);

  const [
    totalStudents,
    newStudentsThisMonth,
    studentsWithActiveToken,
    totalTokens,
    activeTokens,
    expiringTokens,
    revokedTokens,
    expiredTokens,
    todayScans,
    todaySuccessScans,
    todayFailedScans,
    yesterdayScans,
    weekScans,
    unresolvedAnomalies,
    pendingParentRequests,
    subscription,
  ] = await Promise.all([

    // Students
    prisma.student.count({
      where: { school_id: schoolId, is_active: true, deleted_at: null },
    }),
    prisma.student.count({
      where: { school_id: schoolId, is_active: true, deleted_at: null, created_at: { gte: monthStart } },
    }),
    // "logged in" = has at least one ACTIVE token (proxy for registered+active)
    prisma.student.count({
      where: {
        school_id:  schoolId,
        is_active:  true,
        deleted_at: null,
        tokens:     { some: { status: "ACTIVE" } },
      },
    }),

    // Tokens
    prisma.token.count({ where: { school_id: schoolId } }),
    prisma.token.count({ where: { school_id: schoolId, status: "ACTIVE" } }),
    prisma.token.count({
      where: { school_id: schoolId, status: "ACTIVE", expires_at: { gte: now, lte: in30Days } },
    }),
    prisma.token.count({ where: { school_id: schoolId, status: "REVOKED" } }),
    prisma.token.count({ where: { school_id: schoolId, status: "EXPIRED" } }),

    // Scans
    prisma.scanLog.count({
      where: { token: { school_id: schoolId }, created_at: { gte: todayStart, lt: todayEnd } },
    }),
    prisma.scanLog.count({
      where: { token: { school_id: schoolId }, result: "SUCCESS", created_at: { gte: todayStart, lt: todayEnd } },
    }),
    prisma.scanLog.count({
      where: {
        token:      { school_id: schoolId },
        result:     { in: ["INVALID", "REVOKED", "EXPIRED", "RATE_LIMITED", "ERROR"] },
        created_at: { gte: todayStart, lt: todayEnd },
      },
    }),
    prisma.scanLog.count({
      where: { token: { school_id: schoolId }, created_at: { gte: yesterdayStart, lt: todayStart } },
    }),
    prisma.scanLog.count({
      where: { token: { school_id: schoolId }, created_at: { gte: weekStart } },
    }),

    // Alerts
    prisma.scanAnomaly.count({
      where: { token: { school_id: schoolId }, resolved: false },
    }),
    prisma.parentEditLog.count({ where: { school_id: schoolId } }),

    // Subscription
    prisma.subscription.findFirst({
      where:   { school_id: schoolId, status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] } },
      orderBy: { created_at: "desc" },
      select:  { id: true, status: true, plan: true, current_period_end: true },
    }),
  ]);

  const scanTrendUp = yesterdayScans > 0
    ? todayScans >= yesterdayScans
    : null;
  const scanChangePct = yesterdayScans > 0
    ? Math.round(((todayScans - yesterdayScans) / yesterdayScans) * 100)
    : null;

  return {
    students: {
      total:           totalStudents,
      newThisMonth:    newStudentsThisMonth,
      withActiveToken: studentsWithActiveToken,
    },
    tokens: {
      total:    totalTokens,
      active:   activeTokens,
      expiring: expiringTokens,
      revoked:  revokedTokens,
      expired:  expiredTokens,
    },
    scans: {
      today:          todayScans,
      todaySuccess:   todaySuccessScans,
      todayFailed:    todayFailedScans,
      yesterday:      yesterdayScans,
      thisWeek:       weekScans,
      scanTrendUp,
      scanChangePct,
    },
    alerts: {
      unresolvedAnomalies,
      pendingParentRequests,
    },
    subscription,
  };
};

/**
 * 7-day scan trend for area chart
 */
export const getScanTrend = async (schoolId) => {
  const rows = [];
  for (let i = 6; i >= 0; i--) {
    const d     = new Date();
    d.setDate(d.getDate() - i);
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const end   = new Date(start.getTime() + 86_400_000);

    const [success, failed] = await Promise.all([
      prisma.scanLog.count({
        where: { token: { school_id: schoolId }, result: "SUCCESS", created_at: { gte: start, lt: end } },
      }),
      prisma.scanLog.count({
        where: {
          token:      { school_id: schoolId },
          result:     { in: ["INVALID", "REVOKED", "EXPIRED", "RATE_LIMITED", "ERROR"] },
          created_at: { gte: start, lt: end },
        },
      }),
    ]);

    rows.push({
      date: start.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }),
      success,
      failed,
    });
  }
  return rows;
};

/**
 * Token status breakdown for donut chart
 */
export const getTokenBreakdown = async (schoolId) => {
  const statuses = ["UNASSIGNED", "ISSUED", "ACTIVE", "INACTIVE", "REVOKED", "EXPIRED"];
  const rows = await Promise.all(
    statuses.map(async (status) => ({
      status,
      count: await prisma.token.count({ where: { school_id: schoolId, status } }),
    })),
  );
  return rows.filter((r) => r.count > 0);
};

// ─── Student Activity ─────────────────────────────────────────────────────────

export const listStudentActivity = async (schoolId, { page, limit, sortDir, search, class: cls, section, has_scanned, token_status }) => {
  const skip  = (page - 1) * limit;
  const where = {
    school_id:  schoolId,
    is_active:  true,
    deleted_at: null,
    ...(cls     && { class: cls }),
    ...(section && { section }),
    ...(token_status && { tokens: { some: { status: token_status } } }),
    ...(has_scanned === true  && { tokens: { some: { scans: { some: {} } } } }),
    ...(has_scanned === false && { tokens: { none: { scans: { some: {} } } } }),
    ...(search && {
      OR: [
        { first_name:  { contains: search, mode: "insensitive" } },
        { last_name:   { contains: search, mode: "insensitive" } },
        { roll_number: { contains: search, mode: "insensitive" } },
      ],
    }),
  };

  const [total, items] = await Promise.all([
    prisma.student.count({ where }),
    prisma.student.findMany({
      where,
      skip,
      take:    limit,
      orderBy: { created_at: sortDir },
      select: {
        id:          true,
        first_name:  true,
        last_name:   true,
        photo_url:   true,
        class:       true,
        section:     true,
        roll_number: true,
        setup_stage: true,
        created_at:  true,
        tokens: {
          select: {
            id:         true,
            status:     true,
            expires_at: true,
            scans: {
              orderBy: { created_at: "desc" },
              take:    1,
              select:  { created_at: true, result: true },
            },
          },
          orderBy: { created_at: "desc" },
          take:    1,
        },
      },
    }),
  ]);

  // Flatten for the table: last_scan, scan_count, token_status
  const enriched = await Promise.all(
    items.map(async (s) => {
      const token     = s.tokens[0] || null;
      const scanCount = token
        ? await prisma.scanLog.count({ where: { token_id: token.id } })
        : 0;
      return {
        id:            s.id,
        first_name:    s.first_name,
        last_name:     s.last_name,
        photo_url:     s.photo_url,
        class:         s.class,
        section:       s.section,
        roll_number:   s.roll_number,
        setup_stage:   s.setup_stage,
        created_at:    s.created_at,
        token_status:  token?.status   || null,
        token_expires: token?.expires_at || null,
        last_scan_at:  token?.scans[0]?.created_at || null,
        last_scan_result: token?.scans[0]?.result  || null,
        total_scans:   scanCount,
      };
    }),
  );

  return { total, items: enriched };
};

// ─── Tokens ───────────────────────────────────────────────────────────────────

export const listTokens = async (schoolId, { page, limit, sortDir, status, expiring }) => {
  const skip = (page - 1) * limit;
  const now  = new Date();
  const in30 = new Date(now.getTime() + 30 * 86_400_000);

  const where = {
    school_id: schoolId,
    ...(status   && { status }),
    ...(expiring && { status: "ACTIVE", expires_at: { gte: now, lte: in30 } }),
  };

  const [total, items] = await Promise.all([
    prisma.token.count({ where }),
    prisma.token.findMany({
      where,
      skip,
      take:    limit,
      orderBy: { created_at: sortDir },
      select: {
        id:           true,
        status:       true,
        expires_at:   true,
        activated_at: true,
        assigned_at:  true,
        revoked_at:   true,
        created_at:   true,
        student: {
          select: { id: true, first_name: true, last_name: true, class: true, section: true, photo_url: true },
        },
      },
    }),
  ]);

  return { total, items };
};

// ─── Scan Logs ────────────────────────────────────────────────────────────────

export const listScanLogs = async (schoolId, { page, limit, sortDir, result, student_id, token_id, from, to }) => {
  const skip  = (page - 1) * limit;
  const where = {
    token: {
      school_id: schoolId,
      ...(student_id && { student_id }),
    },
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
        latitude:         true,
        longitude:        true,
        response_time_ms: true,
        created_at:       true,
        token: {
          select: {
            id:     true,
            status: true,
            student: {
              select: { id: true, first_name: true, last_name: true, class: true, photo_url: true },
            },
          },
        },
      },
    }),
  ]);

  return { total, items };
};

// ─── Anomalies ────────────────────────────────────────────────────────────────

export const listAnomalies = async (schoolId, { page, limit, sortDir, severity, type, resolved, from, to }) => {
  const skip  = (page - 1) * limit;
  const where = {
    token: { school_id: schoolId },
    ...(severity  && { severity }),
    ...(type      && { anomaly_type: type }),
    ...(resolved  !== undefined && { resolved }),
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
              select: { id: true, first_name: true, last_name: true, class: true, photo_url: true },
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

// ─── Parent Requests ──────────────────────────────────────────────────────────

export const listParentRequests = async (schoolId, { page, limit, sortDir, field_group, student_id, from, to }) => {
  const skip  = (page - 1) * limit;
  const where = {
    school_id: schoolId,
    ...(field_group && { field_group }),
    ...(student_id  && { student_id }),
    ...((from || to) && {
      created_at: {
        ...(from && { gte: new Date(from) }),
        ...(to   && { lte: new Date(to) }),
      },
    }),
  };

  const [total, items] = await Promise.all([
    prisma.parentEditLog.count({ where }),
    prisma.parentEditLog.findMany({
      where,
      skip,
      take:    limit,
      orderBy: { created_at: sortDir },
      select: {
        id:          true,
        field_group: true,
        old_value:   true,
        new_value:   true,
        ip_address:  true,
        created_at:  true,
        student: {
          select: { id: true, first_name: true, last_name: true, class: true, photo_url: true },
        },
        parent: {
          select: { id: true, name: true, phone: true, email: true },
        },
      },
    }),
  ]);

  return { total, items };
};

// ─── Emergency Profiles ───────────────────────────────────────────────────────

export const listEmergencyProfiles = async (schoolId, { page, limit, student_id, visibility, blood_group }) => {
  const skip  = (page - 1) * limit;
  const where = {
    student: { school_id: schoolId, is_active: true, deleted_at: null, ...(student_id && { id: student_id }) },
    ...(visibility  && { visibility }),
    ...(blood_group && { blood_group }),
  };

  const [total, items] = await Promise.all([
    prisma.emergencyProfile.count({ where }),
    prisma.emergencyProfile.findMany({
      where,
      skip,
      take:    limit,
      orderBy: { created_at: "desc" },
      include: {
        contacts: { where: { is_active: true }, orderBy: { priority: "asc" } },
        student:  { select: { id: true, first_name: true, last_name: true, class: true, section: true, photo_url: true } },
      },
    }),
  ]);

  return { total, items };
};

export const findEmergencyProfileByStudent = async (schoolId, studentId) =>
  prisma.emergencyProfile.findFirst({
    where:   { student_id: studentId, student: { school_id: schoolId } },
    include: { contacts: { orderBy: { priority: "asc" } }, student: true },
  });

// ─── Notifications ────────────────────────────────────────────────────────────

export const listNotifications = async (schoolId, { page, limit, type, status, from, to }) => {
  const skip  = (page - 1) * limit;
  const where = {
    school_id: schoolId,
    ...(type   && { type }),
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
        student: { select: { id: true, first_name: true, last_name: true } },
        parent:  { select: { id: true, name: true, phone: true } },
      },
    }),
  ]);

  return { total, items };
};

export const getUnreadNotifCount = async (schoolId) =>
  prisma.notification.count({ where: { school_id: schoolId, status: "QUEUED" } });

/**
 * Create a SCAN_ALERT notification for school admin
 * Called by scan webhook / scan service after every successful scan
 */
export const createScanAlertNotification = async ({ schoolId, studentId, parentId, payload }) =>
  prisma.notification.create({
    data: {
      school_id:  schoolId,
      student_id: studentId || null,
      parent_id:  parentId  || null,
      type:       "SCAN_ALERT",
      channel:    "PUSH",
      status:     "QUEUED",
      payload,
    },
  });