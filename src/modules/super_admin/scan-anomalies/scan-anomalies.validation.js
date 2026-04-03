// =============================================================================
// scan-anomalies.validation.js — RESQID Super Admin Scan Anomalies
// Validates query params, params, and body for scan anomaly management
// =============================================================================

import { z } from 'zod';

export const listAnomaliesQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(10),
    search: z.string().optional(),
    resolved: z.enum(['RESOLVED', 'UNRESOLVED']).optional(),
    anomaly_type: z
      .enum([
        'HIGH_FREQUENCY',
        'MULTIPLE_LOCATIONS',
        'SUSPICIOUS_IP',
        'AFTER_HOURS',
        'BULK_SCRAPING',
        'HONEYPOT_TRIGGERED',
        'REPEATED_FAILURE',
      ])
      .optional(),
    severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
    from_date: z.string().datetime().optional(),
    to_date: z.string().datetime().optional(),
    sort_field: z.enum(['created_at', 'severity', 'anomaly_type']).default('created_at'),
    sort_dir: z.enum(['asc', 'desc']).default('desc'),
  })
  .strict();

export const anomalyIdParamSchema = z
  .object({
    id: z.string().uuid(),
  })
  .strict();

export const resolveAnomalyBodySchema = z
  .object({
    resolved_by: z.string().optional(),
  })
  .strict();

export const getAnomalyStatsQuerySchema = z
  .object({
    from_date: z.string().datetime().optional(),
    to_date: z.string().datetime().optional(),
  })
  .strict();

export const getAnomalyFiltersQuerySchema = z.object({}).strict();
