// =============================================================================
// scan-logs.validation.js — RESQID Super Admin Scan Logs
// Validates query params for scan log management endpoints
// =============================================================================

import { z } from 'zod';

export const listScanLogsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(10),
    search: z.string().optional(),
    school_id: z.string().uuid().optional(),
    result: z
      .enum([
        'SUCCESS',
        'INVALID',
        'REVOKED',
        'EXPIRED',
        'INACTIVE',
        'UNREGISTERED',
        'ISSUED',
        'RATE_LIMITED',
        'ERROR',
      ])
      .optional(),
    scan_type: z.enum(['EMERGENCY', 'CHECK_IN', 'ATTENDANCE', 'OTHER']).optional(),
    scan_purpose: z.enum(['QR_SCAN', 'MANUAL_LOOKUP', 'HONEYPOT']).optional(),
    from_date: z.string().datetime().optional(),
    to_date: z.string().datetime().optional(),
    sort_field: z.enum(['created_at', 'response_time_ms']).default('created_at'),
    sort_dir: z.enum(['asc', 'desc']).default('desc'),
  })
  .strict();

export const scanLogIdParamSchema = z
  .object({
    id: z.string().uuid(),
  })
  .strict();

export const getScanLogStatsQuerySchema = z
  .object({
    from_date: z.string().datetime().optional(),
    to_date: z.string().datetime().optional(),
  })
  .strict();

export const getScanLogFiltersQuerySchema = z.object({}).strict();
