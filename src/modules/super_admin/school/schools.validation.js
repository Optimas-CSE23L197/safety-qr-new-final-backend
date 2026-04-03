// =============================================================================
// schools.validation.js — RESQID Super Admin Schools
// Validates query params, params, and body for school management endpoints
// =============================================================================

import { z } from 'zod';

export const listSchoolsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(10),
    search: z.string().optional(),
    city: z.string().optional(),
    subscription_status: z
      .enum(['ACTIVE', 'TRIALING', 'PAST_DUE', 'CANCELED', 'EXPIRED'])
      .optional(),
    status: z.enum(['active', 'inactive']).optional(),
    sort_field: z.enum(['name', 'city', 'students', 'created_at']).default('created_at'),
    sort_dir: z.enum(['asc', 'desc']).default('desc'),
  })
  .strict();

export const schoolIdParamSchema = z
  .object({
    id: z.string().uuid(),
  })
  .strict();

export const toggleSchoolStatusBodySchema = z
  .object({
    is_active: z.boolean(),
  })
  .strict();

export const getSchoolStatsQuerySchema = z.object({}).strict();
