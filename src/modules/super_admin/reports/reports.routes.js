// =============================================================================
// reports.routes.js — RESQID Super Admin
// All routes: SUPER_ADMIN only
// =============================================================================

import { Router }            from 'express';
import { authenticate }      from '#middleware/auth.middleware.js';
import { requireSuperAdmin } from '#middleware/rbac.middleware.js';
import { ReportsController } from './reports.controller.js';

const router = Router();

// ── Auth guard ────────────────────────────────────────────────────────────────
router.use(authenticate, requireSuperAdmin);

// ── Chart data ────────────────────────────────────────────────────────────────
router.get('/revenue', ReportsController.getMonthlyRevenue);
router.get('/scans',   ReportsController.getMonthlyScanVolume);

// ── CSV exports ───────────────────────────────────────────────────────────────
router.get('/export/revenue',              ReportsController.exportRevenue);
router.get('/export/school-activity',      ReportsController.exportSchoolActivity);
router.get('/export/platform-growth',      ReportsController.exportPlatformGrowth);
router.get('/export/subscription-cohort',  ReportsController.exportSubscriptionCohort);

export default router;