// =============================================================================
// modules/school_admin/anomalies/anomaly.routes.js — RESQID
// Mounted at: /api/school-admin
//
// Routes:
//   GET   /api/school-admin/:schoolId/anomalies
//   PATCH /api/school-admin/:schoolId/anomalies/:anomalyId/resolve
// =============================================================================

import { Router } from 'express';
import { authenticate, requireSchoolUser } from '#middleware/auth.middleware.js';
import { validateListAnomalies, validateResolveAnomaly } from './scanAnomaly.validation.js';
import { listAnomalies, resolveAnomalyHandler } from './scanAnomaly.controller.js';

const router = Router();

// List anomalies — paginated, filterable by resolved status + type
router.get(
  '/:schoolId/anomalies',
  authenticate,
  requireSchoolUser,
  validateListAnomalies,
  listAnomalies
);

// Resolve a single anomaly — school admin action
// PATCH (not POST) because we're partially updating an existing resource
router.patch(
  '/:schoolId/anomalies/:anomalyId/resolve',
  authenticate,
  requireSchoolUser,
  validateResolveAnomaly,
  resolveAnomalyHandler
);

export default router;
