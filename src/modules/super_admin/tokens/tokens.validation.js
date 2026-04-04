// =============================================================================
// tokens.validation.js — RESQID Super Admin Tokens
// Validates query params, params, and body for token management endpoints
// =============================================================================

import { z } from 'zod';

export const listTokensQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(10),
    search: z.string().optional(),
    status: z.enum(['UNASSIGNED', 'ISSUED', 'ACTIVE', 'INACTIVE', 'REVOKED', 'EXPIRED']).optional(),
    batch_id: z.string().uuid().optional(),
    school_id: z.string().uuid().optional(),
    sort_field: z.enum(['created_at', 'expires_at', 'status']).default('created_at'),
    sort_dir: z.enum(['asc', 'desc']).default('desc'),
  })
  .strict();

export const tokenIdParamSchema = z
  .object({
    id: z.string().uuid(),
  })
  .strict();

export const revokeTokenBodySchema = z
  .object({
    reason: z.string().optional(),
  })
  .strict();

export const replaceTokenBodySchema = z
  .object({
    new_token_hash: z.string().optional(),
  })
  .strict();

export const getTokenStatsQuerySchema = z
  .object({
    days_to_expire: z.coerce.number().int().min(1).max(90).default(30),
  })
  .strict();

export const getTokenBatchesQuerySchema = z
  .object({
    school_id: z.string().uuid().optional(),
  })
  .strict();
