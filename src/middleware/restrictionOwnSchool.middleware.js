// =============================================================================
// restrictionOwnSchool.middleware.js — RESQID
// Ensures school users can ONLY access data within their own school
// Ensures parents can ONLY access their own children's data
// Single violation = immediate 403 — no partial access
//
// FIX [#6]: ownSchoolOnly relies on req.schoolId being set by tenantScope.
// If tenantScope is skipped on a route, req.schoolId is undefined, and the
// check (undefined !== someId) is always true → every school user gets 403.
// Added an explicit guard that throws a 500 with a clear message so the
// misconfiguration is caught immediately in dev/staging rather than silently
// blocking all school users in production.
// =============================================================================

import { prisma } from '#config/database/prisma.js';
import { redis } from '#config/database/redis.js';
import { ApiError } from '#utils/response/ApiError.js';
import { asyncHandler } from '#utils/response/asyncHandler.js';

const PARENT_CHILDREN_TTL = 2 * 60; // 2 minutes

// ─── School User Restriction ──────────────────────────────────────────────────

/**
 * ownSchoolOnly
 * Validates that any schoolId in params/body matches the authenticated school
 * Applied on all school-admin routes that reference a school
 *
 * REQUIRES: tenantScope to run before this middleware on the same route.
 */
export const ownSchoolOnly = asyncHandler(async (req, _res, next) => {
  if (req.role === 'SUPER_ADMIN') return next(); // super admin bypasses

  const requestedSchoolId = req.params.schoolId ?? req.params.school_id ?? req.body?.school_id;

  if (!requestedSchoolId) return next(); // no school ref in request — ok

  // FIX [#6]: If req.schoolId is undefined here, tenantScope was not applied.
  // Fail with 500 + a descriptive message so the route misconfiguration is
  // caught immediately rather than silently blocking all school users.
  if (req.role === 'SCHOOL_USER' && req.schoolId === undefined) {
    throw ApiError.internal(
      'ownSchoolOnly requires tenantScope to run first — missing on this route'
    );
  }

  if (req.schoolId !== requestedSchoolId) {
    throw ApiError.forbidden('Access to this school is not permitted');
  }

  next();
});

// ─── Parent Restriction ───────────────────────────────────────────────────────

/**
 * ownChildrenOnly
 * Validates that a parent can only access students linked to them
 * Checks ParentStudent relationship in DB (cached in Redis)
 */
export const ownChildrenOnly = asyncHandler(async (req, _res, next) => {
  if (req.role !== 'PARENT_USER') return next();

  const studentId = req.params.studentId ?? req.params.student_id ?? req.body?.student_id;

  if (!studentId) return next();

  const parentId = req.userId;
  const isChild = await verifyParentChild(parentId, studentId);

  if (!isChild) {
    throw ApiError.forbidden('You do not have access to this student');
  }

  req.studentId = studentId;
  next();
});

/**
 * ownProfileOnly
 * Parent can only access/modify their own profile
 */
export const ownProfileOnly = asyncHandler(async (req, _res, next) => {
  if (req.role !== 'PARENT_USER') return next();

  const requestedId = req.params.parentId ?? req.params.id;

  if (requestedId && requestedId !== req.userId) {
    throw ApiError.forbidden('You can only access your own profile');
  }

  next();
});

// ─── Token Ownership ──────────────────────────────────────────────────────────

/**
 * ownTokenOnly
 * School user can only access tokens belonging to their school
 *
 * REQUIRES: tenantScope to run before this middleware on the same route.
 */
export const ownTokenOnly = asyncHandler(async (req, _res, next) => {
  if (req.role === 'SUPER_ADMIN') return next();

  const tokenId = req.params.tokenId ?? req.params.token_id;
  if (!tokenId) return next();

  // FIX [#6]: Same guard as ownSchoolOnly — catch missing tenantScope early.
  if (req.role === 'SCHOOL_USER' && req.schoolId === undefined) {
    throw ApiError.internal(
      'ownTokenOnly requires tenantScope to run first — missing on this route'
    );
  }

  const token = await prisma.token.findUnique({
    where: { id: tokenId },
    select: { school_id: true },
  });

  if (!token) throw ApiError.notFound('Token not found');

  if (req.schoolId && token.school_id !== req.schoolId) {
    throw ApiError.forbidden('This token does not belong to your school');
  }

  next();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function verifyParentChild(parentId, studentId) {
  const key = `parent_children:${parentId}`;
  const cached = await redis.get(key);

  let childIds;
  if (cached) {
    childIds = JSON.parse(cached);
  } else {
    const links = await prisma.parentStudent.findMany({
      where: { parent_id: parentId },
      select: { student_id: true },
    });
    childIds = links.map(l => l.student_id);
    await redis.setex(key, PARENT_CHILDREN_TTL, JSON.stringify(childIds));
  }

  return childIds.includes(studentId);
}

/**
 * invalidateParentChildrenCache
 * Call this whenever a parent-student link changes
 */
export async function invalidateParentChildrenCache(parentId) {
  await redis.del(`parent_children:${parentId}`);
}
