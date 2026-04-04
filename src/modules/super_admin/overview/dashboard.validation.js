// =============================================================================
// dashboard.validation.js — RESQID Super Admin Dashboard
// Validates query parameters for dashboard data aggregation endpoints
// =============================================================================

import { z } from 'zod';

export const dashboardStatsQuerySchema = z
  .object({
    from_date: z.string().datetime().optional(),
    to_date: z.string().datetime().optional(),
    school_id: z.string().uuid().optional(),
  })
  .strict();

export const dashboardGrowthQuerySchema = z
  .object({
    months: z.coerce.number().int().min(1).max(24).default(12),
    school_id: z.string().uuid().optional(),
  })
  .strict();

export const dashboardSubscriptionBreakdownQuerySchema = z
  .object({
    school_id: z.string().uuid().optional(),
  })
  .strict();

export const dashboardRecentSchoolsQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(10),
  })
  .strict();

export const dashboardRecentAuditQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    actor_type: z.enum(['SUPER_ADMIN', 'ADMIN', 'SYSTEM']).optional(),
  })
  .strict();
