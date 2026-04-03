// =============================================================================
// scan-anomalies.controller.js — RESQID Super Admin Scan Anomalies
// HTTP handlers for scan anomaly management endpoints
// =============================================================================

import { asyncHandler } from '#shared/response/asyncHandler.js';
import { ApiResponse } from '#shared/response/ApiResponse.js';
import { ScanAnomaliesService } from './scan-anomalies.service.js';
import {
  listAnomaliesQuerySchema,
  anomalyIdParamSchema,
  resolveAnomalyBodySchema,
  getAnomalyStatsQuerySchema,
  getAnomalyFiltersQuerySchema,
} from './scan-anomalies.validation.js';

const scanAnomaliesService = new ScanAnomaliesService();

export const listAnomalies = asyncHandler(async (req, res) => {
  const query = listAnomaliesQuerySchema.parse(req.query);
  const result = await scanAnomaliesService.listAnomalies(query);
  return ApiResponse.paginated(res, result.data, result.meta, 'Anomalies fetched successfully');
});

export const getAnomalyById = asyncHandler(async (req, res) => {
  const { id } = anomalyIdParamSchema.parse(req.params);
  const anomaly = await scanAnomaliesService.getAnomalyById(id);
  return ApiResponse.ok(res, anomaly, 'Anomaly fetched successfully');
});

export const resolveAnomaly = asyncHandler(async (req, res) => {
  const { id } = anomalyIdParamSchema.parse(req.params);
  const { resolved_by } = resolveAnomalyBodySchema.parse(req.body);
  const resolved = await scanAnomaliesService.resolveAnomaly(id, resolved_by);
  return ApiResponse.ok(res, resolved, 'Anomaly marked as resolved');
});

export const getAnomalyStats = asyncHandler(async (req, res) => {
  const { from_date, to_date } = getAnomalyStatsQuerySchema.parse(req.query);
  const stats = await scanAnomaliesService.getStats({ from_date, to_date });
  return ApiResponse.ok(res, stats, 'Anomaly stats fetched successfully');
});

export const getAnomalyFilters = asyncHandler(async (req, res) => {
  getAnomalyFiltersQuerySchema.parse(req.query);
  const filters = await scanAnomaliesService.getFilters();
  return ApiResponse.ok(res, filters, 'Anomaly filters fetched successfully');
});
