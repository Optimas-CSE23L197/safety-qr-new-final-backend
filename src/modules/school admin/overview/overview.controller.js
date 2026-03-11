// =============================================================================
// monitoring.controller.js — RESQID School Admin
// Thin HTTP layer — extract from req → call service → send ApiResponse
// =============================================================================

import { ApiResponse }  from "../../utils/Response/ApiResponse.js";
import { asyncHandler } from "../../utils/Response/asyncHandler.js";
import * as service     from "./monitoring.service.js";

// ─── Overview ────────────────────────────────────────────────────────────────

/** GET /monitoring/overview — full dashboard payload */
export const getOverview = asyncHandler(async (req, res) => {
  const data = await service.getFullOverview(req.user.school_id);
  return ApiResponse.ok(data, "Monitoring overview loaded").send(res);
});

/** GET /monitoring/stats — KPI numbers only */
export const getStats = asyncHandler(async (req, res) => {
  const data = await service.getStats(req.user.school_id);
  return ApiResponse.ok(data).send(res);
});

/** GET /monitoring/scan-trend — 7-day area chart data */
export const getScanTrend = asyncHandler(async (req, res) => {
  const data = await service.getScanTrend(req.user.school_id);
  return ApiResponse.ok(data).send(res);
});

/** GET /monitoring/token-breakdown — donut chart data */
export const getTokenBreakdown = asyncHandler(async (req, res) => {
  const data = await service.getTokenBreakdown(req.user.school_id);
  return ApiResponse.ok(data).send(res);
});

// ─── Student Activity ─────────────────────────────────────────────────────────

/** GET /monitoring/students */
export const listStudentActivity = asyncHandler(async (req, res) => {
  const result = await service.listStudentActivity(req.user.school_id, req.query);
  return ApiResponse.paginated(result.items, result.meta).send(res);
});

// ─── Tokens ───────────────────────────────────────────────────────────────────

/** GET /monitoring/tokens */
export const listTokens = asyncHandler(async (req, res) => {
  const result = await service.listTokens(req.user.school_id, req.query);
  return ApiResponse.paginated(result.items, result.meta).send(res);
});

// ─── Scan Logs ────────────────────────────────────────────────────────────────

/** GET /monitoring/scan-logs */
export const listScanLogs = asyncHandler(async (req, res) => {
  const result = await service.listScanLogs(req.user.school_id, req.query);
  return ApiResponse.paginated(result.items, result.meta).send(res);
});

// ─── Anomalies ────────────────────────────────────────────────────────────────

/** GET /monitoring/anomalies */
export const listAnomalies = asyncHandler(async (req, res) => {
  const result = await service.listAnomalies(req.user.school_id, req.query);
  return ApiResponse.paginated(result.items, result.meta).send(res);
});

/** PATCH /monitoring/anomalies/:id/resolve */
export const resolveAnomaly = asyncHandler(async (req, res) => {
  const data = await service.resolveAnomaly(
    req.user.school_id,
    req.params.id,
    req.userId,
    req.body.notes,
  );
  return ApiResponse.ok(data, "Anomaly resolved").send(res);
});

// ─── Parent Requests ──────────────────────────────────────────────────────────

/** GET /monitoring/parent-requests */
export const listParentRequests = asyncHandler(async (req, res) => {
  const result = await service.listParentRequests(req.user.school_id, req.query);
  return ApiResponse.paginated(result.items, result.meta).send(res);
});

// ─── Emergency Profiles ───────────────────────────────────────────────────────

/** GET /monitoring/emergency-profiles */
export const listEmergencyProfiles = asyncHandler(async (req, res) => {
  const result = await service.listEmergencyProfiles(req.user.school_id, req.query);
  return ApiResponse.paginated(result.items, result.meta).send(res);
});

/** GET /monitoring/students/:id/emergency-profile */
export const getEmergencyProfile = asyncHandler(async (req, res) => {
  const data = await service.getEmergencyProfile(req.user.school_id, req.params.id);
  return ApiResponse.ok(data).send(res);
});

// ─── Notifications ────────────────────────────────────────────────────────────

/** GET /monitoring/notifications */
export const listNotifications = asyncHandler(async (req, res) => {
  const result = await service.listNotifications(req.user.school_id, req.query);
  return ApiResponse.paginated(result.items, result.meta).send(res);
});

/** GET /monitoring/notifications/unread-count — lightweight badge poll */
export const getUnreadCount = asyncHandler(async (req, res) => {
  const data = await service.getUnreadCount(req.user.school_id);
  return ApiResponse.ok(data).send(res);
});