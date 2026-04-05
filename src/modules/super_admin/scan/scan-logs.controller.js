// =============================================================================
// scan-logs.controller.js — RESQID Super Admin Scan Logs
// HTTP handlers for scan log management endpoints
// =============================================================================

import { asyncHandler } from '#shared/response/asyncHandler.js';
import { ApiResponse } from '#shared/response/ApiResponse.js';
import { ScanLogsService } from './scan-logs.service.js';
import {
  listScanLogsQuerySchema,
  scanLogIdParamSchema,
  getScanLogStatsQuerySchema,
  getScanLogFiltersQuerySchema,
} from './scan-logs.validation.js';

const scanLogsService = new ScanLogsService();

export const listScanLogs = asyncHandler(async (req, res) => {
  const query = listScanLogsQuerySchema.parse(req.query);
  const result = await scanLogsService.listScanLogs(query);
  return ApiResponse.paginated(res, result.data, result.meta, 'Scan logs fetched successfully');
});

export const getScanLogById = asyncHandler(async (req, res) => {
  const { id } = scanLogIdParamSchema.parse(req.params);
  const scanLog = await scanLogsService.getScanLogById(id);
  return ApiResponse.ok(res, scanLog, 'Scan log fetched successfully');
});

export const getScanLogStats = asyncHandler(async (req, res) => {
  const { from_date, to_date } = getScanLogStatsQuerySchema.parse(req.query);
  const stats = await scanLogsService.getStats({ from_date, to_date });
  return ApiResponse.ok(res, stats, 'Scan log stats fetched successfully');
});

export const getScanLogFilters = asyncHandler(async (req, res) => {
  getScanLogFiltersQuerySchema.parse(req.query);
  const filters = await scanLogsService.getFilters();
  return ApiResponse.ok(res, filters, 'Scan log filters fetched successfully');
});
