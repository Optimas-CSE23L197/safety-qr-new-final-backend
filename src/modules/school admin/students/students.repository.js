// =============================================================================
// students.repository.js — RESQID School Admin › Students
// Pure Prisma data access — zero business logic, zero ApiErrors
// Returns data or null — service layer decides what to do
// =============================================================================

import { prisma } from "../../../config/prisma.js";

// ─── Student list ─────────────────────────────────────────────────────────────

export const listStudents = async (
  schoolId,
  { page, limit, sortBy, sortDir, search, class: cls, section, setup_stage, is_active, token_status },
) => {
  const skip = (page - 1) * limit;

  const where = {
    school_id:  schoolId,
    deleted_at: null,
    ...(is_active   !== undefined && { is_active }),
    ...(cls         && { class: cls }),
    ...(section     && { section }),
    ...(setup_stage && { setup_stage }),
    ...(search && {
      OR: [
        { first_name:       { contains: search, mode: "insensitive" } },
        { last_name:        { contains: search, mode: "insensitive" } },
        { roll_number:      { contains: search, mode: "insensitive" } },
        { admission_number: { contains: search, mode: "insensitive" } },
      ],
    }),
    // Filter by token status via relation
    ...(token_status && {
      tokens: { some: { status: token_status } },
    }),
  };

  const orderBy = sortBy ? { [sortBy]: sortDir } : { created_at: sortDir };

  const [total, items] = await Promise.all([
    prisma.student.count({ where }),
    prisma.student.findMany({
      where,
      skip,
      take: limit,
      orderBy,
      select: {
        id:               true,
        first_name:       true,
        last_name:        true,
        photo_url:        true,
        gender:           true,
        dob:              true,
        class:            true,
        section:          true,
        roll_number:      true,
        admission_number: true,
        setup_stage:      true,
        is_active:        true,
        created_at:       true,
        // Active token (latest 1)
        tokens: {
          orderBy: { created_at: "desc" },
          take:    1,
          select: {
            id:           true,
            status:       true,
            expires_at:   true,
            activated_at: true,
          },
        },
        // Primary parent
        parents: {
          where:  { is_primary: true },
          select: {
            is_primary: true,
            parent: { select: { id: true, name: true, phone: true } },
          },
          take: 1,
        },
        // Last scan (latest 1 via token)
        _count: { select: { tokens: true } },
      },
    }),
  ]);

  // Attach last scan activity per student in one extra parallel query
  const studentIds = items.map((s) => s.id);
  const lastScans  = await prisma.scanLog.findMany({
    where:   { token: { student_id: { in: studentIds } } },
    orderBy: { created_at: "desc" },
    distinct: ["token_id"],
    select: {
      id:         true,
      result:     true,
      created_at: true,
      token:      { select: { student_id: true } },
    },
  });

  // Map last scan by student_id
  const lastScanMap = Object.fromEntries(
    lastScans.map((s) => [s.token.student_id, { result: s.result, created_at: s.created_at }]),
  );

  const enriched = items.map((s) => ({
    ...s,
    last_scan: lastScanMap[s.id] ?? null,
  }));

  return { total, items: enriched };
};

// ─── Student detail ───────────────────────────────────────────────────────────

export const findStudentById = async (schoolId, studentId) =>
  prisma.student.findFirst({
    where: { id: studentId, school_id: schoolId, deleted_at: null },
    include: {
      tokens: {
        orderBy: { created_at: "desc" },
        select: {
          id:           true,
          status:       true,
          expires_at:   true,
          activated_at: true,
          assigned_at:  true,
          revoked_at:   true,
          created_at:   true,
        },
      },
      parents: {
        include: {
          parent: { select: { id: true, name: true, phone: true, email: true } },
        },
      },
      emergency: {
        include: { contacts: { orderBy: { priority: "asc" } } },
      },
      cardVisibility: true,
    },
  });

// ─── Student scan activity ────────────────────────────────────────────────────

/**
 * Paginated recent scan activity for a single student.
 * Joins through token → scanLog.
 */
export const getStudentScanActivity = async (schoolId, studentId, { page, limit }) => {
  const skip = (page - 1) * limit;

  const where = {
    token: { school_id: schoolId, student_id: studentId },
  };

  const [total, items] = await Promise.all([
    prisma.scanLog.count({ where }),
    prisma.scanLog.findMany({
      where,
      skip,
      take:    limit,
      orderBy: { created_at: "desc" },
      select: {
        id:               true,
        result:           true,
        ip_address:       true,
        ip_city:          true,
        ip_country:       true,
        latitude:         true,
        longitude:        true,
        device_hash:      true,
        user_agent:       true,
        response_time_ms: true,
        scan_purpose:     true,
        created_at:       true,
        token: { select: { id: true, status: true } },
      },
    }),
  ]);

  return { total, items };
};

// ─── Create / Update / Delete ─────────────────────────────────────────────────

export const createStudent = async (schoolId, data) => {
  // Check admission_number uniqueness within the school
  if (data.admission_number) {
    const existing = await prisma.student.findFirst({
      where: { school_id: schoolId, admission_number: data.admission_number, deleted_at: null },
    });
    if (existing) return { conflict: "admission_number" };
  }

  const student = await prisma.student.create({
    data:    { school_id: schoolId, ...data },
    include: { parents: { include: { parent: true } } },
  });

  return { student };
};

export const updateStudent = async (schoolId, studentId, data) => {
  // Admission number uniqueness check (skip if not changing)
  if (data.admission_number) {
    const existing = await prisma.student.findFirst({
      where: {
        school_id:        schoolId,
        admission_number: data.admission_number,
        deleted_at:       null,
        id:               { not: studentId },
      },
    });
    if (existing) return { conflict: "admission_number" };
  }

  const student = await prisma.student.update({
    where: { id: studentId },
    data:  { ...data, updated_at: new Date() },
    include: {
      tokens:  { select: { id: true, status: true, expires_at: true } },
      parents: { include: { parent: { select: { id: true, name: true, phone: true, email: true } } } },
    },
  });

  return { student };
};

export const softDeleteStudent = async (studentId) =>
  prisma.student.update({
    where: { id: studentId },
    data:  { is_active: false, deleted_at: new Date() },
  });

// ─── Parent requests ──────────────────────────────────────────────────────────

export const listParentRequests = async (
  schoolId,
  { page, limit, sortDir, status, student_id, field_group, from, to },
) => {
  const skip = (page - 1) * limit;

  const where = {
    school_id: schoolId,
    ...(status      && { status }),
    ...(student_id  && { student_id }),
    ...(field_group && { field_group }),
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
        id:           true,
        field_group:  true,
        old_value:    true,
        new_value:    true,
        status:       true,
        reviewed_by:  true,
        reviewed_at:  true,
        review_notes: true,
        ip_address:   true,
        created_at:   true,
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
        parent: {
          select: { id: true, name: true, phone: true, email: true },
        },
      },
    }),
  ]);

  return { total, items };
};

export const findParentRequestById = async (schoolId, requestId) =>
  prisma.parentEditLog.findFirst({
    where: { id: requestId, school_id: schoolId },
    include: {
      student: true,
      parent:  { select: { id: true, name: true, phone: true, email: true } },
    },
  });

export const approveParentRequest = async (requestId, reviewedBy, notes) =>
  prisma.parentEditLog.update({
    where: { id: requestId },
    data: {
      status:       "APPROVED",
      reviewed_by:  reviewedBy,
      reviewed_at:  new Date(),
      review_notes: notes ?? null,
    },
  });

export const rejectParentRequest = async (requestId, reviewedBy, reason) =>
  prisma.parentEditLog.update({
    where: { id: requestId },
    data: {
      status:       "REJECTED",
      reviewed_by:  reviewedBy,
      reviewed_at:  new Date(),
      review_notes: reason,
    },
  });

// ─── Token ID card data ───────────────────────────────────────────────────────

/**
 * Full token card data for a student — used to render the ID card preview.
 */
export const getStudentTokenCard = async (schoolId, studentId) => {
  const student = await prisma.student.findFirst({
    where: { id: studentId, school_id: schoolId, deleted_at: null },
    select: {
      id:               true,
      first_name:       true,
      last_name:        true,
      photo_url:        true,
      class:            true,
      section:          true,
      roll_number:      true,
      admission_number: true,
      dob:              true,
      gender:           true,
      tokens: {
        where:   { status: { in: ["ACTIVE", "ISSUED"] } },
        orderBy: { created_at: "desc" },
        take:    1,
        select: {
          id:           true,
          status:       true,
          expires_at:   true,
          activated_at: true,
          assigned_at:  true,
        },
      },
      parents: {
        where:  { is_primary: true },
        select: {
          parent: { select: { id: true, name: true, phone: true } },
        },
        take: 1,
      },
    },
  });

  if (!student) return null;

  // School info for the card header
  const school = await prisma.school.findUnique({
    where:  { id: schoolId },
    select: { id: true, name: true, code: true, logo_url: true, school_type: true },
  });

  return { student, school };
};

// ─── Counts for sidebar badge ─────────────────────────────────────────────────

export const getPendingRequestCount = async (schoolId) =>
  prisma.parentEditLog.count({
    where: { school_id: schoolId, status: "PENDING" },
  });