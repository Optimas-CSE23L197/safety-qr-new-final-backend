// =============================================================================
// monitoring.controller.js — RESQID School Admin › Scan Monitoring
// Thin HTTP layer only — extract, delegate to service, respond
// =============================================================================

import { ApiError } from "../../../utils/response/ApiError.js";
import { asyncHandler } from "../../../utils/response/asyncHandler.js";
import * as svc         from "./monitoring.service.js";

// ─── Overview ─────────────────────────────────────────────────────────────────

export const getOverview = asyncHandler(async (req, res) => {
  const data = await svc.getOverview(req.user.school_id);
  return ApiResponse.ok(data, "Monitoring overview").send(res);
});

export const getStats = asyncHandler(async (req, res) => {
  const data = await svc.getStats(req.user.school_id);
  return ApiResponse.ok(data, "Scan stats").send(res);
});

export const getScanTrend = asyncHandler(async (req, res) => {
  const data = await svc.getScanTrend(req.user.school_id);
  return ApiResponse.ok(data, "Scan trend").send(res);
});

export const getResultBreakdown = asyncHandler(async (req, res) => {
  const data = await svc.getResultBreakdown(req.user.school_id);
  return ApiResponse.ok(data, "Result breakdown").send(res);
});

// ─── Scan Logs ────────────────────────────────────────────────────────────────

export const listScanLogs = asyncHandler(async (req, res) => {
  const result = await svc.listScanLogs(req.user.school_id, req.query);
  return ApiResponse.paginated(result.items, result.meta).send(res);
});

export const getScanLog = asyncHandler(async (req, res) => {
  const data = await svc.getScanLog(req.user.school_id, req.params.id);
  return ApiResponse.ok(data, "Scan log detail").send(res);
});

// ─── Anomalies ────────────────────────────────────────────────────────────────

export const listAnomalies = asyncHandler(async (req, res) => {
  const result = await svc.listAnomalies(req.user.school_id, req.query);
  return ApiResponse.paginated(result.items, result.meta).send(res);
});

export const resolveAnomaly = asyncHandler(async (req, res) => {
  const data = await svc.resolveAnomaly(
    req.user.school_id,
    req.params.id,
    req.userId,
    req.body?.notes,
  );
  return ApiResponse.ok(data, "Anomaly resolved successfully").send(res);
});

// ─── Multi-Device ─────────────────────────────────────────────────────────────

export const getMultiDevice = asyncHandler(async (req, res) => {
  const result = await svc.getMultiDeviceScans(req.user.school_id, req.query);
  return ApiResponse.paginated(result.items, result.meta).send(res);
});

// ─── Notifications ────────────────────────────────────────────────────────────

export const listNotifications = asyncHandler(async (req, res) => {
  const result = await svc.listNotifications(req.user.school_id, req.query);
  return ApiResponse.paginated(result.items, result.meta).send(res);
});

export const getUnreadCount = asyncHandler(async (req, res) => {
  const data = await svc.getUnreadCount(req.user.school_id);
  return ApiResponse.ok(data).send(res);
});