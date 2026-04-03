// =============================================================================
// parents.validation.js — RESQID Super Admin Parents
// Validates query params, params, and body for parent management endpoints
// =============================================================================

import { z } from 'zod';

export const listParentsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    search: z.string().optional(),
    status: z.enum(['ACTIVE', 'SUSPENDED', 'DELETED']).optional(),
    phone_verified: z.enum(['YES', 'NO']).optional(),
    email_verified: z.enum(['YES', 'NO']).optional(),
    platform: z.enum(['IOS', 'ANDROID', 'WEB']).optional(),
    sort_field: z.enum(['name', 'phone', 'created_at', 'last_login_at']).default('created_at'),
    sort_dir: z.enum(['asc', 'desc']).default('desc'),
  })
  .strict();

export const parentIdParamSchema = z
  .object({
    id: z.string().uuid(),
  })
  .strict();

export const toggleParentStatusBodySchema = z
  .object({
    status: z.enum(['ACTIVE', 'SUSPENDED']),
  })
  .strict();

export const revokeDevicesBodySchema = z
  .object({
    revoke_all: z.boolean().default(true),
  })
  .strict();

export const getParentStatsQuerySchema = z.object({}).strict();

export const getParentFiltersQuerySchema = z.object({}).strict();
