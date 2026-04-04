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

export const registerSchoolSchema = z
  .object({
    school: z.object({
      name: z.string().min(1).max(100),
      address: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
      pincode: z.string().optional(),
      email: z.string().email().optional(),
      phone: z.string().optional(),
      timezone: z.string().default('Asia/Kolkata'),
      school_type: z.enum(['GOVERNMENT', 'PRIVATE', 'INTERNATIONAL', 'NGO']).default('PRIVATE'),
    }),
    admin: z.object({
      name: z.string().min(1),
      email: z.string().email(),
      password: z.string().min(8),
    }),
    subscription: z.object({
      plan: z.enum(['BASIC', 'PREMIUM', 'CUSTOM']),
      student_count: z.number().int().min(1).default(0),
      custom_unit_price: z.number().int().optional(),
      custom_renewal_price: z.number().int().optional(),
      is_pilot: z.boolean().default(false),
      pilot_expires_at: z.string().datetime().optional(),
    }),
    agreement: z.object({
      agreed_via: z.enum(['DASHBOARD', 'PHYSICAL', 'EMAIL']).default('DASHBOARD'),
      ip_address: z.string().optional(),
    }),
  })
  .strict();
