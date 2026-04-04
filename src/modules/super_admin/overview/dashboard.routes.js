// =============================================================================
// dashboard.routes.js — RESQID Super Admin Dashboard
// Routes for platform-wide analytics and KPIs
// =============================================================================

import { Router } from 'express';
import {
  getDashboardStats,
  getDashboardGrowth,
  getSubscriptionBreakdown,
  getRecentSchools,
  getRecentAuditLogs,
  getSystemHealth,
  getCompleteDashboard,
} from './dashboard.controller.js';

const router = Router();

router.get('/stats', getDashboardStats);
router.get('/growth', getDashboardGrowth);
router.get('/subscription-breakdown', getSubscriptionBreakdown);
router.get('/recent-schools', getRecentSchools);
router.get('/recent-audit', getRecentAuditLogs);
router.get('/system-health', getSystemHealth);
router.get('/complete', getCompleteDashboard);

export default router;
