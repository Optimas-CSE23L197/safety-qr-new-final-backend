// =============================================================================
// monitoring.routes.js — RESQID School Admin › Scan Monitoring
//
// Mount in app.js:
//   import monitoringRouter from "./school-admin/monitoring/monitoring.routes.js";
//   app.use("/api/v1/school-admin/monitoring", monitoringRouter);
//
// Every route:  authenticate → requireSchoolUser → can(permission) → validate → ctrl
// =============================================================================

import { Router }                                   from "express";
import {authenticate, requireSchoolUser}              from "../../../middleware/auth.middleware.js";
import { can }                                      from "../../../middleware/rbac.middleware.js";
import { validate, validateAll }                    from "../../../middleware/validate.middleware.js";
import * as ctrl                                    from "./monitoring.controller.js";
import {
  uuidParam,
  scanLogQuerySchema,
  anomalyQuerySchema,
  resolveAnomalySchema,
  multiDeviceQuerySchema,
  notificationQuerySchema,
} from "./monitoring.validation.js";

const router = Router();

// All monitoring routes require a valid school-admin JWT
router.use(authenticate, requireSchoolUser);

// =============================================================================
// OVERVIEW — stats, charts, breakdown
// =============================================================================

/**
 * GET /api/v1/school-admin/monitoring/overview
 * Full dashboard payload: stats + 7-day trend + today's result breakdown
 * Permission: scan_log:read
 */
router.get(
  "/overview",
  can("scan_log:read"),
  ctrl.getOverview,
);

/**
 * GET /api/v1/school-admin/monitoring/stats
 * Today's KPI numbers only (lighter payload for auto-refresh)
 */
router.get(
  "/stats",
  can("scan_log:read"),
  ctrl.getStats,
);

/**
 * GET /api/v1/school-admin/monitoring/scan-trend
 * 7-day { date, success, failed, total }[]
 */
router.get(
  "/scan-trend",
  can("scan_log:read"),
  ctrl.getScanTrend,
);

/**
 * GET /api/v1/school-admin/monitoring/result-breakdown
 * Today's per-result counts for donut chart
 */
router.get(
  "/result-breakdown",
  can("scan_log:read"),
  ctrl.getResultBreakdown,
);

// =============================================================================
// SCAN LOGS
// =============================================================================

/**
 * GET /api/v1/school-admin/monitoring/scan-logs
 * Paginated scan log list with filters:
 *   result, student_known, token_id, student_id, from, to
 */
router.get(
  "/scan-logs",
  can("scan_log:read"),
  validate(scanLogQuerySchema, "query"),
  ctrl.listScanLogs,
);

/**
 * GET /api/v1/school-admin/monitoring/scan-logs/:id
 * Full scan log detail including linked anomalies
 */
router.get(
  "/scan-logs/:id",
  can("scan_log:read"),
  validate(uuidParam, "params"),
  ctrl.getScanLog,
);

// =============================================================================
// ANOMALIES
// =============================================================================

/**
 * GET /api/v1/school-admin/monitoring/anomalies
 * Filters: severity, type, resolved (true/false), from, to
 * Omit `resolved` to see ALL anomalies; pass false for open only
 */
router.get(
  "/anomalies",
  can("anomaly:read"),
  validate(anomalyQuerySchema, "query"),
  ctrl.listAnomalies,
);

/**
 * PATCH /api/v1/school-admin/monitoring/anomalies/:id/resolve
 * Body: { notes?: string }
 * Marks anomaly as resolved, stamps resolved_at + resolved_by
 */
router.patch(
  "/anomalies/:id/resolve",
  can("anomaly:read"),
  validateAll({ params: uuidParam, body: resolveAnomalySchema }),
  ctrl.resolveAnomaly,
);

// =============================================================================
// MULTI-DEVICE DETECTION
// =============================================================================

/**
 * GET /api/v1/school-admin/monitoring/multi-device
 * Tokens scanned from >= min_devices distinct device_hashes
 * Filters: min_devices (default 2), from, to
 */
router.get(
  "/multi-device",
  can("scan_log:read"),
  validate(multiDeviceQuerySchema, "query"),
  ctrl.getMultiDevice,
);

// =============================================================================
// NOTIFICATIONS
// =============================================================================

/**
 * GET /api/v1/school-admin/monitoring/notifications
 * Scan-scoped notifications: SCAN_ALERT, SCAN_ANOMALY, CARD_REVOKED, DEVICE_LOGIN
 * Filters: type, status, from, to
 */
router.get(
  "/notifications",
  can("scan_log:read"),
  validate(notificationQuerySchema, "query"),
  ctrl.listNotifications,
);

/**
 * GET /api/v1/school-admin/monitoring/notifications/unread-count
 * Lightweight endpoint polled every 15 s for the bell badge
 */
router.get(
  "/notifications/unread-count",
  can("scan_log:read"),
  ctrl.getUnreadCount,
);

export default router;