// =============================================================================
// admins.validation.js — RESQID Super Admin Admin Management
// Validates query params, params, and body for admin management endpoints
// =============================================================================

import { z } from 'zod';

export const listAdminsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(10),
    search: z.string().optional(),
    role: z.enum(['SUPER_ADMIN', 'ADMIN']).optional(),
    status: z.enum(['active', 'inactive']).optional(),
    sort_field: z.enum(['name', 'email', 'last_login_at', 'created_at']).default('created_at'),
    sort_dir: z.enum(['asc', 'desc']).default('desc'),
  })
  .strict();

export const adminIdParamSchema = z
  .object({
    id: z.string().uuid(),
  })
  .strict();

export const toggleAdminStatusBodySchema = z
  .object({
    is_active: z.boolean(),
  })
  .strict();

export const resetPasswordBodySchema = z
  .object({
    email: z.string().email().optional(),
  })
  .strict();

export const getAdminStatsQuerySchema = z.object({}).strict();
