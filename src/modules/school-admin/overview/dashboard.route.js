// =============================================================================
// modules/dashboard/dashboard.route.js — RESQID
// Mounted at: /api/school
// Full path:  GET /api/school/:schoolId/dashboard
// =============================================================================

import { Router } from 'express';
import { authenticate, requireSchoolUser } from '#middleware/auth/auth.middleware.js';
import { validateDashboardParams } from './dashboard.validation.js';
import { getDashboard } from './dashboard.controller.js';

const router = Router();

router.get(
  '/:schoolId/dashboard',
  authenticate, // 1. verify JWT → attach req.user, req.role
  requireSchoolUser, // 2. role must be SCHOOL_USER → else 403
  validateDashboardParams, // 3. validate UUID + tenant isolation
  getDashboard // 4. handle
);

export default router;
