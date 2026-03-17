// =============================================================================
// monitoring.routes.js — RESQID School Admin
// All monitoring routes — all protected, SCHOOL_USER ADMIN only
//
// Mount in main router:
//   app.use('/api/v1/school-admin/monitoring', monitoringRouter)
// =============================================================================

import { Router }                          from "express";
import { authenticate, requireSchoolUser } from "../../../middleware/auth.middleware.js";
import { can }                             from "../../../middleware/rbac.middleware.js";
import { validate, validateAll }           from "../../../middleware/validate.middleware.js";
import * as ctrl                           from "./overview.controller.js";
import {
  statsQuerySchema,
  studentActivityQuerySchema,
  tokenMonitorQuerySchema,
  scanLogQuerySchema,
  anomalyQuerySchema,
  resolveAnomalySchema,
  parentRequestQuerySchema,
  emergencyProfileQuerySchema,
  notificationQuerySchema,
  uuidParam,
} from "./overview.validation.js";

const router = Router();

// All monitoring routes require authenticated school admin
router.use(authenticate, requireSchoolUser);

// ─── Overview ─────────────────────────────────────────────────────────────────

/** GET /monitoring/overview — full page payload (KPIs + charts + feeds) */
router.get("/overview",        can("scan_log:read"), ctrl.getOverview);

/** GET /monitoring/stats — KPI cards only */
router.get("/stats",           can("scan_log:read"), validate(statsQuerySchema, "query"),  ctrl.getStats);

/** GET /monitoring/scan-trend — 7-day area chart */
router.get("/scan-trend",      can("scan_log:read"), ctrl.getScanTrend);

/** GET /monitoring/token-breakdown — donut chart */
router.get("/token-breakdown", can("token:read"),    ctrl.getTokenBreakdown);

// ─── Students ─────────────────────────────────────────────────────────────────

/** GET /monitoring/students — activity table: last scan, scan count, token status */
router.get(
  "/students",
  can("student:read"),
  validate(studentActivityQuerySchema, "query"),
  ctrl.listStudentActivity,
);

// ─── Tokens ───────────────────────────────────────────────────────────────────

/** GET /monitoring/tokens */
router.get(
  "/tokens",
  can("token:read"),
  validate(tokenMonitorQuerySchema, "query"),
  ctrl.listTokens,
);

// ─── Scan Logs ────────────────────────────────────────────────────────────────

/** GET /monitoring/scan-logs */
router.get(
  "/scan-logs",
  can("scan_log:read"),
  validate(scanLogQuerySchema, "query"),
  ctrl.listScanLogs,
);

// ─── Anomalies ────────────────────────────────────────────────────────────────

/** GET /monitoring/anomalies */
router.get(
  "/anomalies",
  can("anomaly:read"),
  validate(anomalyQuerySchema, "query"),
  ctrl.listAnomalies,
);

/** PATCH /monitoring/anomalies/:id/resolve */
router.patch(
  "/anomalies/:id/resolve",
  can("anomaly:read"),
  validateAll({ params: uuidParam, body: resolveAnomalySchema }),
  ctrl.resolveAnomaly,
);

// ─── Parent Requests ──────────────────────────────────────────────────────────

/** GET /monitoring/parent-requests */
router.get(
  "/parent-requests",
  can("student:read"),
  validate(parentRequestQuerySchema, "query"),
  ctrl.listParentRequests,
);

// ─── Emergency Profiles ───────────────────────────────────────────────────────

/** GET /monitoring/emergency-profiles */
router.get(
  "/emergency-profiles",
  can("student:read"),
  validate(emergencyProfileQuerySchema, "query"),
  ctrl.listEmergencyProfiles,
);

/** GET /monitoring/students/:id/emergency-profile */
router.get(
  "/students/:id/emergency-profile",
  can("student:read"),
  validate(uuidParam, "params"),
  ctrl.getEmergencyProfile,
);

// ─── Notifications ────────────────────────────────────────────────────────────

/** GET /monitoring/notifications */
router.get(
  "/notifications",
  can("scan_log:read"),
  validate(notificationQuerySchema, "query"),
  ctrl.listNotifications,
);

/** GET /monitoring/notifications/unread-count — badge poll, Redis cached 20 s */
router.get(
  "/notifications/unread-count",
  can("scan_log:read"),
  ctrl.getUnreadCount,
);

export default router;