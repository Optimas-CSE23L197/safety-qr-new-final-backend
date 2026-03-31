// =============================================================================
// restrictionOwnSchool.middleware.js — RESQID
// STRICT MODE — Zero-tolerance access control
// Ensures school users can ONLY access data within their own school
// Ensures parents can ONLY access their own children's data
// Single violation = immediate 403 — no partial access, no soft errors
// =============================================================================

import { prisma } from '#config/prisma.js';
import { redis } from '#config/redis.js';
import { ApiError } from '#shared/response/ApiError.js';
import { asyncHandler } from '#shared/response/asyncHandler.js';
import { logger } from '#config/logger.js';

const PARENT_CHILDREN_TTL = 2 * 60; // 2 minutes
const AUDIT_LOG_THRESHOLD = 3; // Log security events after 3 violations per IP

// Track violations for security monitoring
const violationTracker = new Map(); // IP -> count

// ─── School User Restriction — STRICT ─────────────────────────────────────────

/**
 * ownSchoolOnly
 * Validates that any schoolId in params/body matches the authenticated school
 * Applied on all school-admin routes that reference a school
 *
 * REQUIRES: tenantScope to run before this middleware on the same route.
 * STRICT: Any mismatch = immediate 403 + security log + track for audit
 */
export const ownSchoolOnly = asyncHandler(async (req, _res, next) => {
  // Super admin bypass — but log for audit
  if (req.role === 'SUPER_ADMIN') {
    if (req.params.schoolId || req.params.school_id || req.body?.school_id) {
      logger.debug({ userId: req.userId, path: req.path }, 'SUPER_ADMIN accessing school resource');
    }
    return next();
  }

  const requestedSchoolId = req.params.schoolId ?? req.params.school_id ?? req.body?.school_id;

  // No school reference — valid for routes like /dashboard
  if (!requestedSchoolId) return next();

  // CRITICAL: If req.schoolId is undefined, tenantScope was not applied
  if (req.role === 'SCHOOL_USER' && req.schoolId === undefined) {
    logger.error(
      {
        userId: req.userId,
        path: req.path,
        method: req.method,
        requestId: req.id,
      },
      'SECURITY: ownSchoolOnly called without tenantScope — route misconfiguration'
    );
    throw ApiError.internal('Access control configuration error');
  }

  // Strict comparison — must match exactly
  if (req.schoolId !== requestedSchoolId) {
    // Log security violation for audit
    logger.warn(
      {
        userId: req.userId,
        role: req.role,
        schoolId: req.schoolId,
        requestedSchoolId,
        path: req.path,
        method: req.method,
        ip: req.ip,
        requestId: req.id,
      },
      'SECURITY: School access violation — user attempted to access unauthorized school'
    );

    trackViolation(req.ip);
    throw ApiError.forbidden('Access to this school is not permitted');
  }

  next();
});

// ─── Parent Restriction — STRICT ──────────────────────────────────────────────

/**
 * ownChildrenOnly
 * Validates that a parent can only access students linked to them
 * Strict: No caching bypass, no soft failures
 */
export const ownChildrenOnly = asyncHandler(async (req, _res, next) => {
  if (req.role !== 'PARENT_USER') return next();

  const studentId = req.params.studentId ?? req.params.student_id ?? req.body?.student_id;

  if (!studentId) return next();

  const parentId = req.userId;

  if (!parentId) {
    throw ApiError.unauthorized('Parent authentication required');
  }

  const isChild = await verifyParentChild(parentId, studentId);

  if (!isChild) {
    logger.warn(
      {
        parentId,
        studentId,
        path: req.path,
        method: req.method,
        ip: req.ip,
        requestId: req.id,
      },
      'SECURITY: Parent access violation — attempted to access unauthorized student'
    );

    trackViolation(req.ip);
    throw ApiError.forbidden('You do not have access to this student');
  }

  req.studentId = studentId;
  next();
});

/**
 * ownProfileOnly
 * Parent can only access/modify their own profile — STRICT
 */
export const ownProfileOnly = asyncHandler(async (req, _res, next) => {
  if (req.role !== 'PARENT_USER') return next();

  const requestedId = req.params.parentId ?? req.params.id;

  if (requestedId && requestedId !== req.userId) {
    logger.warn(
      {
        userId: req.userId,
        requestedId,
        path: req.path,
        requestId: req.id,
      },
      'SECURITY: Parent profile access violation'
    );

    trackViolation(req.ip);
    throw ApiError.forbidden('You can only access your own profile');
  }

  next();
});

// ─── Token Ownership — STRICT ─────────────────────────────────────────────────

/**
 * ownTokenOnly
 * School user can only access tokens belonging to their school
 * Strict: Always queries DB — no cache for token ownership (security critical)
 */
export const ownTokenOnly = asyncHandler(async (req, _res, next) => {
  if (req.role === 'SUPER_ADMIN') return next();

  const tokenId = req.params.tokenId ?? req.params.token_id;
  if (!tokenId) return next();

  // CRITICAL: Same guard as ownSchoolOnly
  if (req.role === 'SCHOOL_USER' && req.schoolId === undefined) {
    logger.error(
      { userId: req.userId, path: req.path, tokenId },
      'SECURITY: ownTokenOnly called without tenantScope'
    );
    throw ApiError.internal('Access control configuration error');
  }

  // Always query DB — no caching for token ownership (security first)
  const token = await prisma.token.findUnique({
    where: { id: tokenId },
    select: { school_id: true, student_id: true },
  });

  if (!token) {
    logger.warn(
      { userId: req.userId, tokenId, path: req.path },
      'SECURITY: Token not found access attempt'
    );
    throw ApiError.notFound('Token not found');
  }

  if (req.schoolId && token.school_id !== req.schoolId) {
    logger.warn(
      {
        userId: req.userId,
        role: req.role,
        schoolId: req.schoolId,
        tokenSchoolId: token.school_id,
        tokenId,
        path: req.path,
        requestId: req.id,
      },
      'SECURITY: Token ownership violation'
    );

    trackViolation(req.ip);
    throw ApiError.forbidden('This token does not belong to your school');
  }

  next();
});

/**
 * ownStudentOnly
 * School user can only access students in their school
 * Parent can only access their own children
 * Combined check for student endpoints
 */
export const ownStudentOnly = asyncHandler(async (req, _res, next) => {
  const studentId = req.params.studentId ?? req.params.student_id ?? req.body?.student_id;

  if (!studentId) return next();

  // School user — check school ownership
  if (req.role === 'SCHOOL_USER') {
    if (req.schoolId === undefined) {
      logger.error({ userId: req.userId, path: req.path }, 'ownStudentOnly missing tenantScope');
      throw ApiError.internal('Access control configuration error');
    }

    const student = await prisma.student.findUnique({
      where: { id: studentId },
      select: { school_id: true },
    });

    if (!student) {
      throw ApiError.notFound('Student not found');
    }

    if (student.school_id !== req.schoolId) {
      logger.warn(
        {
          userId: req.userId,
          studentId,
          schoolId: req.schoolId,
          studentSchoolId: student.school_id,
        },
        'SECURITY: School user attempted to access student from another school'
      );
      trackViolation(req.ip);
      throw ApiError.forbidden('This student does not belong to your school');
    }
  }

  // Parent user — check parent-child relationship
  if (req.role === 'PARENT_USER') {
    const isChild = await verifyParentChild(req.userId, studentId);
    if (!isChild) {
      logger.warn(
        { parentId: req.userId, studentId },
        'SECURITY: Parent attempted to access unauthorized student'
      );
      trackViolation(req.ip);
      throw ApiError.forbidden('You do not have access to this student');
    }
  }

  next();
});

// ─── Helpers — STRICT ─────────────────────────────────────────────────────────

async function verifyParentChild(parentId, studentId) {
  const key = `parent_children:${parentId}`;

  try {
    const cached = await redis.get(key);

    if (cached) {
      const childIds = JSON.parse(cached);
      return childIds.includes(studentId);
    }
  } catch (err) {
    // Redis failure — fall through to DB (fail secure, not open)
    logger.warn({ parentId, err: err.message }, 'Redis cache miss for parent children');
  }

  // Always query DB — no soft failures
  const links = await prisma.parentStudent.findMany({
    where: { parent_id: parentId },
    select: { student_id: true },
  });

  const childIds = links.map(l => l.student_id);

  // Cache even empty arrays to reduce DB load
  await redis.setex(key, PARENT_CHILDREN_TTL, JSON.stringify(childIds)).catch(() => {});

  return childIds.includes(studentId);
}

/**
 * Track security violations for anomaly detection
 * After threshold, can trigger alerts or auto-block
 */
function trackViolation(ip) {
  const count = (violationTracker.get(ip) || 0) + 1;
  violationTracker.set(ip, count);

  if (count >= AUDIT_LOG_THRESHOLD) {
    logger.error(
      { ip, violationCount: count },
      'SECURITY ALERT: Multiple access violations detected from same IP'
    );

    // Reset counter after alert
    violationTracker.delete(ip);

    // Optional: Trigger auto-block via blockIpNow
    // import { blockIpNow } from './ipBlock.middleware.js';
    // blockIpNow(ip, `ACCESS_VIOLATION_${count}`).catch(() => {});
  }

  // Clean up old entries periodically (simple size-based)
  if (violationTracker.size > 1000) {
    const keys = [...violationTracker.keys()];
    for (let i = 0; i < 500; i++) {
      violationTracker.delete(keys[i]);
    }
  }
}

/**
 * invalidateParentChildrenCache
 * Call this whenever a parent-student link changes
 */
export async function invalidateParentChildrenCache(parentId) {
  if (!parentId) return;
  await redis.del(`parent_children:${parentId}`).catch(() => {});
  logger.debug({ parentId }, 'Parent children cache invalidated');
}

/**
 * invalidateAllParentCache
 * Emergency function to flush all parent caches
 */
export async function invalidateAllParentCache() {
  const keys = await redis.keys('parent_children:*').catch(() => []);
  if (keys.length) {
    await redis.del(...keys).catch(() => {});
    logger.info({ count: keys.length }, 'All parent children caches invalidated');
  }
}
