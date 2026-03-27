// =============================================================================
// modules/school_admin/scan_logs/scanlog.routes.js — RESQID
// Mounted at: /api/school-admin
// Full path:  GET /api/school-admin/:schoolId/scan-logs
// =============================================================================

import { Router } from 'express';
import { authenticate, requireSchoolUser } from '#middleware/auth/auth.middleware.js';
import { validateListScanLogs } from './scanLog.validation.js';
import { listScanLogs } from './scanLog.controller.js';

const router = Router();

router.get(
  '/:schoolId/scan-logs',
  authenticate,
  requireSchoolUser,
  validateListScanLogs,
  listScanLogs
);

export default router;
