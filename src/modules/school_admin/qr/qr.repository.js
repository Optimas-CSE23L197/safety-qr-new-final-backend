// =============================================================================
// modules/school_admin/qr/qr.repository.js — RESQID
// ALL Prisma calls for QR management. Nothing else.
//
// QUERY STRATEGY
// ─────────────────────────────────────────────────────────────────────────────
// GET list (left panel):
//   Student.findMany with nested token+qrAsset in ONE query
//   No N+1 — everything in a single Prisma call
//   Minimal select — only what the list card needs
//
// GET single (right panel, on click):
//   Student.findUnique with full token+qrAsset detail
//   Includes: token_hash, token status, qr public_url, generated_at
//   Validates ownership: student.school_id must match schoolId
//
// POST assign:
//   Prisma transaction — 3 atomic operations:
//     1. Verify token is UNASSIGNED and belongs to this school
//     2. Link token to student (token.student_id = studentId, status = ISSUED)
//     3. Update student.assigned_at
//   All-or-nothing — partial assignment is not possible
//
// INDEXES USED:
//   Student → @@index([school_id, is_active])
//   Token   → @@index([school_id, status])    — unassigned token filter
//   Token   → @@index([student_id])           — find token by student
//   QrAsset → unique token_id                 — one-to-one with token
// =============================================================================

import { prisma } from '#config/database/prisma.js';

// ─── List students with QR status ─────────────────────────────────────────────

/**
 * findStudentsWithQrStatus({ schoolId, search, filter, skip, take })
 * Returns { students, total }
 *
 * Student shape for list:
 * { id, first_name, last_name, class, section,
 *   token_status, token_id, qr_ready, qr_generated_at }
 */
export async function findStudentsWithQrStatus({ schoolId, search, filter, skip, take }) {
  const where = buildListWhere({ schoolId, search, filter });

  const [rows, total] = await Promise.all([
    prisma.student.findMany({
      where,
      orderBy: [{ first_name: 'asc' }, { last_name: 'asc' }],
      skip,
      take,
      select: {
        id: true,
        first_name: true,
        last_name: true,
        class: true,
        section: true,

        // Get the student's active token + its QR asset in one shot
        // take:1 + orderBy status ensures we get the most relevant token
        tokens: {
          where: { school_id: schoolId, status: { not: 'REVOKED' } },
          orderBy: [
            // Priority: ACTIVE > ISSUED > UNASSIGNED > others
            { activated_at: { sort: 'desc', nulls: 'last' } },
            { created_at: 'desc' },
          ],
          take: 1,
          select: {
            id: true,
            status: true,
            assigned_at: true,
            qrAsset: {
              select: {
                public_url: true,
                generated_at: true,
                is_active: true,
              },
            },
          },
        },
      },
    }),

    prisma.student.count({ where }),
  ]);

  return {
    students: rows.map(shapeListStudent),
    total,
  };
}

// ─── Single student QR detail ─────────────────────────────────────────────────

/**
 * findStudentQrDetail(studentId, schoolId)
 * Returns full QR detail for right panel — or null if not found/not owned
 */
export async function findStudentQrDetail(studentId, schoolId) {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: {
      id: true,
      school_id: true,
      first_name: true,
      last_name: true,
      class: true,
      section: true,
      photo_url: true,

      tokens: {
        where: { school_id: schoolId, status: { not: 'REVOKED' } },
        orderBy: [{ activated_at: { sort: 'desc', nulls: 'last' } }, { created_at: 'desc' }],
        take: 1,
        select: {
          id: true,
          token_hash: true,
          status: true,
          assigned_at: true,
          expires_at: true,
          activated_at: true,
          qrAsset: {
            select: {
              id: true,
              public_url: true,
              storage_key: true,
              format: true,
              width_px: true,
              height_px: true,
              generated_at: true,
              is_active: true,
            },
          },
        },
      },
    },
  });

  // Not found or doesn't belong to this school
  if (!student || student.school_id !== schoolId) return null;

  return shapeDetailStudent(student);
}

// ─── Assign token to student ──────────────────────────────────────────────────

/**
 * assignTokenToStudent({ schoolId, studentId, tokenId })
 * Atomic transaction:
 *   1. Verify token is UNASSIGNED and belongs to this school
 *   2. Verify student belongs to this school and has no active token
 *   3. Link token → student, update token status to ISSUED
 * Returns: { token_id, student_id, status }
 * Throws: AppError with reason if business rule violated
 */
export async function assignTokenToStudent({ schoolId, studentId, tokenId }) {
  return prisma.$transaction(async tx => {
    // [1] Verify token — must be UNASSIGNED and owned by this school
    const token = await tx.token.findUnique({
      where: { id: tokenId },
      select: { id: true, school_id: true, status: true, student_id: true },
    });

    if (!token) {
      throw Object.assign(new Error('Token not found'), {
        code: 'TOKEN_NOT_FOUND',
        statusCode: 404,
      });
    }
    if (token.school_id !== schoolId) {
      throw Object.assign(new Error('Token does not belong to this school'), {
        code: 'TOKEN_NOT_OWNED',
        statusCode: 403,
      });
    }
    if (token.status !== 'UNASSIGNED') {
      throw Object.assign(
        new Error(`Token is ${token.status} — only UNASSIGNED tokens can be assigned`),
        { code: 'TOKEN_NOT_AVAILABLE', statusCode: 409 }
      );
    }

    // [2] Verify student — must belong to school, must be active
    const student = await tx.student.findUnique({
      where: { id: studentId },
      select: {
        id: true,
        school_id: true,
        is_active: true,
        tokens: {
          where: { status: { in: ['ACTIVE', 'ISSUED'] } },
          select: { id: true },
          take: 1,
        },
      },
    });

    if (!student || student.school_id !== schoolId) {
      throw Object.assign(new Error('Student not found'), {
        code: 'STUDENT_NOT_FOUND',
        statusCode: 404,
      });
    }
    if (!student.is_active) {
      throw Object.assign(new Error('Cannot assign token to inactive student'), {
        code: 'STUDENT_INACTIVE',
        statusCode: 409,
      });
    }
    if (student.tokens.length > 0) {
      throw Object.assign(new Error('Student already has an active or issued token'), {
        code: 'STUDENT_ALREADY_HAS_TOKEN',
        statusCode: 409,
      });
    }

    // [3] Link token → student
    const updated = await tx.token.update({
      where: { id: tokenId },
      data: {
        student_id: studentId,
        status: 'ISSUED',
        assigned_at: new Date(),
      },
      select: { id: true, status: true, assigned_at: true },
    });

    return {
      token_id: updated.id,
      student_id: studentId,
      status: updated.status,
      assigned_at: updated.assigned_at,
    };
  });
}

// ─── WHERE Builder ────────────────────────────────────────────────────────────

function buildListWhere({ schoolId, search, filter }) {
  const where = {
    school_id: schoolId,
    is_active: true,
    deleted_at: null,
  };

  // Search: student name or class
  if (search) {
    where.OR = [
      { first_name: { contains: search, mode: 'insensitive' } },
      { last_name: { contains: search, mode: 'insensitive' } },
      { class: { contains: search, mode: 'insensitive' } },
    ];
  }

  // QR filter
  if (filter === 'ready') {
    // Has at least one active token with a QR asset
    where.tokens = {
      some: {
        school_id: schoolId,
        status: 'ACTIVE',
        qrAsset: { is: { is_active: true } },
      },
    };
  } else if (filter === 'no_token') {
    // Has no non-revoked tokens at all
    where.tokens = {
      none: { school_id: schoolId, status: { not: 'REVOKED' } },
    };
  }

  return where;
}

// ─── Shapers ──────────────────────────────────────────────────────────────────

function shapeListStudent(s) {
  const token = s.tokens[0] ?? null;
  const qrAsset = token?.qrAsset ?? null;

  return {
    id: s.id,
    first_name: s.first_name,
    last_name: s.last_name,
    class: s.class,
    section: s.section,
    token_id: token?.id ?? null,
    token_status: token?.status ?? null,
    qr_ready: !!(token?.status === 'ACTIVE' && qrAsset?.is_active),
    qr_generated_at: qrAsset?.generated_at ?? null,
  };
}

function shapeDetailStudent(s) {
  const token = s.tokens[0] ?? null;
  const qrAsset = token?.qrAsset ?? null;

  return {
    id: s.id,
    first_name: s.first_name,
    last_name: s.last_name,
    class: s.class,
    section: s.section,
    photo_url: s.photo_url,

    token: token
      ? {
          id: token.id,
          token_hash: token.token_hash,
          status: token.status,
          assigned_at: token.assigned_at,
          expires_at: token.expires_at,
          activated_at: token.activated_at,
        }
      : null,

    qr_asset: qrAsset
      ? {
          id: qrAsset.id,
          public_url: qrAsset.public_url, // CDN URL — use directly for download/display
          format: qrAsset.format,
          width_px: qrAsset.width_px,
          height_px: qrAsset.height_px,
          generated_at: qrAsset.generated_at,
          is_active: qrAsset.is_active,
        }
      : null,
  };
}
