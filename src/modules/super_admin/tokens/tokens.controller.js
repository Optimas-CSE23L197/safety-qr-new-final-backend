// =============================================================================
// tokens.controller.js — RESQID Super Admin Tokens
// HTTP handlers for token management endpoints
// =============================================================================

import { asyncHandler } from '#shared/response/asyncHandler.js';
import { ApiResponse } from '#shared/response/ApiResponse.js';
import { TokensService } from './tokens.service.js';
import {
  listTokensQuerySchema,
  tokenIdParamSchema,
  revokeTokenBodySchema,
  replaceTokenBodySchema,
  getTokenStatsQuerySchema,
  getTokenBatchesQuerySchema,
} from './tokens.validation.js';

const tokensService = new TokensService();

export const listTokens = asyncHandler(async (req, res) => {
  const query = listTokensQuerySchema.parse(req.query);
  const result = await tokensService.listTokens(query);
  return ApiResponse.paginated(res, result.data, result.meta, 'Tokens fetched successfully');
});

export const getTokenById = asyncHandler(async (req, res) => {
  const { id } = tokenIdParamSchema.parse(req.params);
  const token = await tokensService.getTokenById(id);
  return ApiResponse.ok(res, token, 'Token fetched successfully');
});

export const revokeToken = asyncHandler(async (req, res) => {
  const { id } = tokenIdParamSchema.parse(req.params);
  const { reason } = revokeTokenBodySchema.parse(req.body);
  const updated = await tokensService.revokeToken(id, reason);
  return ApiResponse.ok(res, updated, 'Token revoked successfully');
});

export const replaceToken = asyncHandler(async (req, res) => {
  const { id } = tokenIdParamSchema.parse(req.params);
  replaceTokenBodySchema.parse(req.body);
  const updated = await tokensService.replaceToken(id);
  return ApiResponse.ok(res, updated, 'Token replaced successfully');
});

export const getTokenStats = asyncHandler(async (req, res) => {
  const { days_to_expire } = getTokenStatsQuerySchema.parse(req.query);
  const stats = await tokensService.getStats(days_to_expire);
  return ApiResponse.ok(res, stats, 'Token stats fetched successfully');
});

export const getTokenBatches = asyncHandler(async (req, res) => {
  const { school_id } = getTokenBatchesQuerySchema.parse(req.query);
  const batches = await tokensService.getBatches(school_id);
  return ApiResponse.ok(res, { batches }, 'Token batches fetched successfully');
});
