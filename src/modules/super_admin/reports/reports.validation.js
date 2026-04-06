// =============================================================================
// reports.validation.js — RESQID Super Admin
// =============================================================================

import { z } from 'zod';

/** For chart endpoints — how many months of history to return */
export const chartQuerySchema = z.object({
  months: z.coerce.number().int().min(1).max(24).default(7),
});

/** For CSV export endpoints — window to include in the export */
export const exportQuerySchema = z.object({
  months: z.coerce.number().int().min(1).max(36).default(12),
});