// =============================================================================
// notification.validation.js — RESQID Super Admin
// Zod schemas for notification query params
// =============================================================================

import { z } from 'zod';

// ─── Enums (mirrored from Prisma schema) ─────────────────────────────────────

const NotificationChannelEnum = z.enum(['PUSH', 'EMAIL', 'SMS', 'WHATSAPP']);
const NotificationStatusEnum  = z.enum(['QUEUED', 'SENT', 'FAILED', 'SUPPRESSED']);
const DateRangeEnum = z.enum(['24h', '7d', '30d', 'this_month', 'custom']).default('30d');

// ─── List Notifications ───────────────────────────────────────────────────────
// GET /api/super-admin/notifications
// Matches every filter the frontend sends:
//   school_id, type, channel, status, date_range,
//   date_from + date_to (for custom range), page, limit

export const listNotificationsSchema = z.object({
  // Pagination
  page:  z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),

  // Filters
  school_id:  z.string().uuid('Invalid school_id').optional(),
  type:       z.string().min(1).optional(),           // free-form: SCAN_ALERT, BILLING_ALERT …
  channel:    NotificationChannelEnum.optional(),
  status:     NotificationStatusEnum.optional(),
  date_range: DateRangeEnum.optional(),
  date_from:  z.coerce.date().optional(),             // only used when date_range = custom
  date_to:    z.coerce.date().optional(),             // only used when date_range = custom
}).refine(
  data => {
    // If date_range is 'custom', both date_from and date_to are required
    if (data.date_range === 'custom') {
      return !!data.date_from && !!data.date_to;
    }
    return true;
  },
  { message: 'date_from and date_to are required when date_range is "custom"', path: ['date_from'] }
);

// ─── Stats Query ──────────────────────────────────────────────────────────────
// GET /api/super-admin/notifications/stats
// Optional same date_range filter so stats match the current table view

export const notificationStatsSchema = z.object({
  date_range: DateRangeEnum.optional(),
  date_from:  z.coerce.date().optional(),
  date_to:    z.coerce.date().optional(),
});

// ─── Single Notification ──────────────────────────────────────────────────────
// GET /api/super-admin/notifications/:id

export const notificationIdSchema = z.object({
  id: z.string().uuid('Invalid notification id'),
});