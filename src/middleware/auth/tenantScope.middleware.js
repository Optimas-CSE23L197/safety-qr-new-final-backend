// =============================================================================
// tenantScope.middleware.js — RESQID
// Injects verified school_id into every school-scoped request
// Prevents cross-tenant data leakage — every DB query must filter by school_id
// =============================================================================

import { prisma } from '#config/prisma.js';
import { redis } from '#config/redis.js';
import { ApiError } from '#shared/response/ApiError.js';
import { asyncHandler } from '#shared/response/asyncHandler.js';

const SCHOOL_CACHE_TTL = 5 * 60; // 5 minutes

export const tenantScope = asyncHandler(async (req, _res, next) => {
  // Super admin — no tenant scope, can access all schools
  if (req.role === 'SUPER_ADMIN') {
    req.schoolId = null;
    return next();
  }

  // School user — scope to their own school
  if (req.role === 'SCHOOL_USER') {
    const schoolId = req.user?.school_id;
    if (!schoolId) {
      throw ApiError.forbidden('School user has no associated school');
    }

    const school = await getSchool(schoolId);
    if (!school) throw ApiError.notFound('School not found');
    if (!school.is_active) throw ApiError.forbidden('School account is inactive');

    req.schoolId = schoolId;
    req.school = school;
    return next();
  }

  // Parent — scoped to children's school(s) — handled per-request
  if (req.role === 'PARENT_USER') {
    req.schoolId = null; // parents can have children in multiple schools
    return next();
  }

  throw ApiError.forbidden('Cannot determine tenant scope');
});

async function getSchool(schoolId) {
  const key = `school:${schoolId}`;
  const cached = await redis.get(key);
  if (cached) return JSON.parse(cached);

  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: { id: true, is_active: true, timezone: true, code: true },
  });

  if (school) await redis.setex(key, SCHOOL_CACHE_TTL, JSON.stringify(school));
  return school;
}
