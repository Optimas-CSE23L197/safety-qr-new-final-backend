// =============================================================================
// sessions.controller.js — RESQID Super Admin Sessions
// HTTP handlers for session management endpoints
// =============================================================================

import { asyncHandler } from '#shared/response/asyncHandler.js';
import { ApiResponse } from '#shared/response/ApiResponse.js';
import { SessionsService } from './sessions.service.js';
import {
  listSessionsQuerySchema,
  sessionIdParamSchema,
  revokeSessionBodySchema,
  revokeAllSessionsBodySchema,
  getSessionStatsQuerySchema,
} from './sessions.validation.js';

const sessionsService = new SessionsService();

export const listSessions = asyncHandler(async (req, res) => {
  const query = listSessionsQuerySchema.parse(req.query);
  const result = await sessionsService.listSessions(query);
  return ApiResponse.paginated(res, result.data, result.meta, 'Sessions fetched successfully');
});

export const revokeSession = asyncHandler(async (req, res) => {
  const { id } = sessionIdParamSchema.parse(req.params);
  const { reason } = revokeSessionBodySchema.parse(req.body);
  const revoked = await sessionsService.revokeSession(id, reason);
  return ApiResponse.ok(res, revoked, 'Session revoked successfully');
});

export const revokeAllSessions = asyncHandler(async (req, res) => {
  const { reason } = revokeAllSessionsBodySchema.parse(req.body);
  const result = await sessionsService.revokeAllSessions(reason);
  return ApiResponse.ok(res, result, result.message);
});

export const getSessionStats = asyncHandler(async (req, res) => {
  getSessionStatsQuerySchema.parse(req.query);
  const stats = await sessionsService.getStats();
  return ApiResponse.ok(res, stats, 'Session stats fetched successfully');
});
