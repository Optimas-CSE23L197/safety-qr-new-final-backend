// =============================================================================
// students.validation.js — RESQID Super Admin Students
// Validates query params, params, and body for student management endpoints
// =============================================================================

import { z } from 'zod';

export const listStudentsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    search: z.string().optional(),
    school_id: z.string().uuid().optional(),
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
    token_status: z
      .enum(['UNASSIGNED', 'ISSUED', 'ACTIVE', 'INACTIVE', 'REVOKED', 'EXPIRED'])
      .optional(),
    print_status: z.enum(['PENDING', 'PRINTED', 'REPRINTED', 'FAILED']).optional(),
    class: z.string().optional(),
    sort_field: z.enum(['first_name', 'last_name', 'class', 'created_at']).default('created_at'),
    sort_dir: z.enum(['asc', 'desc']).default('desc'),
  })
  .strict();

export const studentIdParamSchema = z
  .object({
    id: z.string().uuid(),
  })
  .strict();

export const toggleStudentStatusBodySchema = z
  .object({
    is_active: z.boolean(),
  })
  .strict();

export const getStudentStatsQuerySchema = z.object({}).strict();

export const getStudentFiltersQuerySchema = z.object({}).strict();
