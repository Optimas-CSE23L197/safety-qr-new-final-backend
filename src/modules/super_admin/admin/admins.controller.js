// =============================================================================
// admins.controller.js — RESQID Super Admin Admin Management
// HTTP handlers for admin management endpoints
// =============================================================================

import { asyncHandler } from '#shared/response/asyncHandler.js';
import { ApiResponse } from '#shared/response/ApiResponse.js';
import { AdminsService } from './admins.service.js';
import {
  listAdminsQuerySchema,
  adminIdParamSchema,
  toggleAdminStatusBodySchema,
  resetPasswordBodySchema,
  getAdminStatsQuerySchema,
} from './admins.validation.js';

const adminsService = new AdminsService();

export const listAdmins = asyncHandler(async (req, res) => {
  const query = listAdminsQuerySchema.parse(req.query);
  const result = await adminsService.listAdmins(query);
  return ApiResponse.paginated(res, result.data, result.meta, 'Admins fetched successfully');
});

export const getAdminById = asyncHandler(async (req, res) => {
  const { id } = adminIdParamSchema.parse(req.params);
  const { role } = req.query;
  if (!role || !['SUPER_ADMIN', 'ADMIN'].includes(role)) {
    return ApiResponse.badRequest(res, 'role query parameter is required (SUPER_ADMIN or ADMIN)');
  }
  const admin = await adminsService.getAdminById(id, role);
  return ApiResponse.ok(res, admin, 'Admin fetched successfully');
});

export const toggleAdminStatus = asyncHandler(async (req, res) => {
  const { id } = adminIdParamSchema.parse(req.params);
  const { is_active } = toggleAdminStatusBodySchema.parse(req.body);
  const { role } = req.query;
  if (!role || !['SUPER_ADMIN', 'ADMIN'].includes(role)) {
    return ApiResponse.badRequest(res, 'role query parameter is required (SUPER_ADMIN or ADMIN)');
  }
  const updated = await adminsService.toggleAdminStatus(id, role, is_active);
  const message = is_active ? 'Admin activated successfully' : 'Admin deactivated successfully';
  return ApiResponse.ok(res, updated, message);
});

export const resetAdminPassword = asyncHandler(async (req, res) => {
  const { email } = resetPasswordBodySchema.parse(req.body);
  const result = await adminsService.resetAdminPassword(email);
  return ApiResponse.ok(res, result, result.message);
});

export const getAdminsStats = asyncHandler(async (req, res) => {
  getAdminStatsQuerySchema.parse(req.query);
  const stats = await adminsService.getStats();
  return ApiResponse.ok(res, stats, 'Admins stats fetched successfully');
});
