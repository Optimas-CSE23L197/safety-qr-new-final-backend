// =============================================================================
// schools.controller.js — RESQID Super Admin Schools
// HTTP handlers for school management endpoints
// =============================================================================

import { asyncHandler } from '#shared/response/asyncHandler.js';
import { ApiResponse } from '#shared/response/ApiResponse.js';
import { SchoolsService } from './schools.service.js';
import {
  listSchoolsQuerySchema,
  schoolIdParamSchema,
  toggleSchoolStatusBodySchema,
  getSchoolStatsQuerySchema,
  registerSchoolSchema,
} from './schools.validation.js';
import { logger } from '#config/logger.js';

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

  const adminId = req.user?.id;
  if (!adminId) {
    return ApiResponse.error(res, 'Unauthorized: Admin ID not found', 401);
  }

  const updated = await schoolsService.toggleSchoolStatus(id, is_active, adminId);
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

export const registerSchool = asyncHandler(async (req, res) => {
  // Validate request body
  const payload = registerSchoolSchema.parse(req.body);

  // Get super admin ID from request (set by auth middleware)
  const superAdminId = req.user?.id;
  if (!superAdminId) {
    return ApiResponse.error(res, 'Unauthorized: Super admin ID not found', 401);
  }

  // Get client IP address (works with proxy)
  const ipAddress =
    req.ip ||
    req.socket?.remoteAddress ||
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    'unknown';

  // Add IP address to agreement
  const agreementWithIp = {
    ...payload.agreement,
    ip_address: ipAddress,
  };

  // Prepare payload with idempotency key
  const servicePayload = {
    ...payload,
    agreement: agreementWithIp,
    idempotencyKey: payload.idempotencyKey,
  };

  // Register school
  const result = await schoolsService.registerSchool(servicePayload, superAdminId);

  // Log successful registration
  logger.info(
    {
      event: 'school_registered_api',
      school_id: result.school?.id,
      school_name: result.school?.name,
      admin_email: payload.admin.email,
      created_by: superAdminId,
      ip: ipAddress,
      idempotencyKey: payload.idempotencyKey,
    },
    'School registration API called'
  );

  return ApiResponse.created(res, result, 'School registered successfully');
});
