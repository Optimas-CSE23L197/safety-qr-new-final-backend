// =============================================================================
// parents.controller.js — RESQID Super Admin Parents
// HTTP handlers for parent management endpoints
// =============================================================================

import { asyncHandler } from '#shared/response/asyncHandler.js';
import { ApiResponse } from '#shared/response/ApiResponse.js';
import { ParentsService } from './parents.service.js';
import {
  listParentsQuerySchema,
  parentIdParamSchema,
  toggleParentStatusBodySchema,
  revokeDevicesBodySchema,
  getParentStatsQuerySchema,
  getParentFiltersQuerySchema,
} from './parents.validation.js';

const parentsService = new ParentsService();

export const listParents = asyncHandler(async (req, res) => {
  const query = listParentsQuerySchema.parse(req.query);
  const result = await parentsService.listParents(query);
  return ApiResponse.paginated(res, result.data, result.meta, 'Parents fetched successfully');
});

export const getParentById = asyncHandler(async (req, res) => {
  const { id } = parentIdParamSchema.parse(req.params);
  const parent = await parentsService.getParentById(id);
  return ApiResponse.ok(res, parent, 'Parent fetched successfully');
});

export const toggleParentStatus = asyncHandler(async (req, res) => {
  const { id } = parentIdParamSchema.parse(req.params);
  const { status } = toggleParentStatusBodySchema.parse(req.body);
  const updated = await parentsService.updateParentStatus(id, status);
  const message =
    status === 'ACTIVE' ? 'Parent activated successfully' : 'Parent suspended successfully';
  return ApiResponse.ok(res, updated, message);
});

export const revokeParentDevices = asyncHandler(async (req, res) => {
  const { id } = parentIdParamSchema.parse(req.params);
  revokeDevicesBodySchema.parse(req.body);
  const result = await parentsService.revokeAllDevices(id);
  return ApiResponse.ok(res, result, result.message);
});

export const getParentsStats = asyncHandler(async (req, res) => {
  getParentStatsQuerySchema.parse(req.query);
  const stats = await parentsService.getStats();
  return ApiResponse.ok(res, stats, 'Parents stats fetched successfully');
});

export const getParentFilters = asyncHandler(async (req, res) => {
  getParentFiltersQuerySchema.parse(req.query);
  const filters = await parentsService.getFilters();
  return ApiResponse.ok(res, filters, 'Parent filters fetched successfully');
});
