// =============================================================================
// students.controller.js — RESQID Super Admin Students
// HTTP handlers for student management endpoints
// =============================================================================

import { asyncHandler } from '#shared/response/asyncHandler.js';
import { ApiResponse } from '#shared/response/ApiResponse.js';
import { StudentsService } from './students.service.js';
import {
  listStudentsQuerySchema,
  studentIdParamSchema,
  toggleStudentStatusBodySchema,
  getStudentStatsQuerySchema,
  getStudentFiltersQuerySchema,
} from './students.validation.js';

const studentsService = new StudentsService();

export const listStudents = asyncHandler(async (req, res) => {
  const query = listStudentsQuerySchema.parse(req.query);
  const result = await studentsService.listStudents(query);
  return ApiResponse.paginated(res, result.data, result.meta, 'Students fetched successfully');
});

export const getStudentById = asyncHandler(async (req, res) => {
  const { id } = studentIdParamSchema.parse(req.params);
  const student = await studentsService.getStudentById(id);
  return ApiResponse.ok(res, student, 'Student fetched successfully');
});

export const toggleStudentStatus = asyncHandler(async (req, res) => {
  const { id } = studentIdParamSchema.parse(req.params);
  const { is_active } = toggleStudentStatusBodySchema.parse(req.body);
  const updated = await studentsService.toggleStudentStatus(id, is_active);
  const message = is_active ? 'Student activated successfully' : 'Student deactivated successfully';
  return ApiResponse.ok(res, updated, message);
});

export const revokeStudentToken = asyncHandler(async (req, res) => {
  const { id } = studentIdParamSchema.parse(req.params);
  const updated = await studentsService.revokeToken(id);
  return ApiResponse.ok(res, updated, 'Token revoked successfully');
});

export const resetStudentToken = asyncHandler(async (req, res) => {
  const { id } = studentIdParamSchema.parse(req.params);
  const updated = await studentsService.resetToken(id);
  return ApiResponse.ok(res, updated, 'Token reset successfully');
});

export const markCardReprint = asyncHandler(async (req, res) => {
  const { id } = studentIdParamSchema.parse(req.params);
  const updated = await studentsService.markCardReprint(id);
  return ApiResponse.ok(res, updated, 'Card marked for reprint successfully');
});

export const getStudentsStats = asyncHandler(async (req, res) => {
  getStudentStatsQuerySchema.parse(req.query);
  const stats = await studentsService.getStats();
  return ApiResponse.ok(res, stats, 'Students stats fetched successfully');
});

export const getStudentFilters = asyncHandler(async (req, res) => {
  getStudentFiltersQuerySchema.parse(req.query);
  const filters = await studentsService.getFilters();
  return ApiResponse.ok(res, filters, 'Student filters fetched successfully');
});
