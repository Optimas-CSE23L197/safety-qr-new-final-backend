// =============================================================================
// schools.controller.js — RESQID Super Admin Schools
// HTTP handlers for school management endpoints
// =============================================================================

import { asyncHandler } from '../../../shared/response/asyncHandler.js';
import { ApiResponse } from '../../../shared/response/ApiResponse.js';
import { SchoolsService } from './schools.service.js';
import {
  listSchoolsQuerySchema,
  schoolIdParamSchema,
  toggleSchoolStatusBodySchema,
  getSchoolStatsQuerySchema,
} from './schools.validation.js';

const schoolsService = new SchoolsService();

export const listSchools = asyncHandler(async (req, res) => {
  const query = listSchoolsQuerySchema.parse(req.query);
  const result = await schoolsService.listSchools(query);
  return ApiResponse.paginated(res, result.data, result.meta, 'Schools fetched successfully');
});

export const getSchoolById = asyncHandler(async (req, res) => {
  const { id } = schoolIdParamSchema.parse(req.params);
  const school = await schoolsService.getSchoolById(id);
  return ApiResponse.ok(res, school, 'School fetched successfully');
});

export const toggleSchoolStatus = asyncHandler(async (req, res) => {
  const { id } = schoolIdParamSchema.parse(req.params);
  const { is_active } = toggleSchoolStatusBodySchema.parse(req.body);
  const updated = await schoolsService.toggleSchoolStatus(id, is_active);
  const message = is_active ? 'School activated successfully' : 'School deactivated successfully';
  return ApiResponse.ok(res, updated, message);
});

export const getSchoolsStats = asyncHandler(async (req, res) => {
  getSchoolStatsQuerySchema.parse(req.query);
  const stats = await schoolsService.getStats();
  return ApiResponse.ok(res, stats, 'Schools stats fetched successfully');
});

export const getCities = asyncHandler(async (req, res) => {
  const cities = await schoolsService.getCities();
  return ApiResponse.ok(res, { cities }, 'Cities fetched successfully');
});
