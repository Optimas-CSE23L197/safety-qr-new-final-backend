// =============================================================================
// sessions.validation.js — RESQID Super Admin Sessions
// Validates query params, params, and body for session management
// =============================================================================

import { z } from 'zod';

export const listSessionsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(7),
    search: z.string().optional(),
    user_type: z.enum(['PARENT', 'SCHOOL', 'SUPER_ADMIN']).optional(),
    platform: z.enum(['IOS', 'ANDROID', 'WEB']).optional(),
    last_active: z.enum(['1h', '24h', '7d']).optional(),
    status: z.enum(['ACTIVE', 'EXPIRED', 'REVOKED']).optional(),
    sort_field: z.enum(['last_active_at', 'created_at', 'expires_at']).default('last_active_at'),
    sort_dir: z.enum(['asc', 'desc']).default('desc'),
  })
  .strict();

export const sessionIdParamSchema = z
  .object({
    id: z.string().uuid(),
  })
  .strict();

export const revokeSessionBodySchema = z
  .object({
    reason: z.string().optional(),
  })
  .strict();

export const revokeAllSessionsBodySchema = z
  .object({
    reason: z.string().optional(),
  })
  .strict();

export const getSessionStatsQuerySchema = z.object({}).strict();
