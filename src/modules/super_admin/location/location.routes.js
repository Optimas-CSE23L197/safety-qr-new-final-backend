import { Router } from 'express';
import { asyncHandler } from '#shared/response/asyncHandler.js';
import { requireSuperAdmin } from '#middleware/auth/auth.middleware.js';
import { getOverview, getStudents, getStudentHistory, getZones } from './location.controller.js';

const router = Router();

// All routes — super admin only
router.use(requireSuperAdmin);

/**
 * GET /api/super/location/overview
 * Returns KPI stats + school allow_location flags.
 * Used by: KPI row, school access banner, "X schools have location disabled" badge.
 */
router.get('/overview', asyncHandler(getOverview));

/**
 * GET /api/super/location/students
 * Query: school_id?, consent?, zone?, source?, search?, page?, limit?
 * Returns paginated students with consent, last_event, in_zone flag.
 * Used by: list view table, map view markers.
 */
router.get('/students', asyncHandler(getStudents));

/**
 * GET /api/super/location/students/:studentId/history
 * Query: page?, limit?
 * Returns paginated LocationEvent history for one student (StudentPanel).
 */
router.get('/students/:studentId/history', asyncHandler(getStudentHistory));

/**
 * GET /api/super/location/zones
 * Query: school_id?
 * Returns TrustedScanZone rows for the zones table + map circles.
 */
router.get('/zones', asyncHandler(getZones));

export default router;
