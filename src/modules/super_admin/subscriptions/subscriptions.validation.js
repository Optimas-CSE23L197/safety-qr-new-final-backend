// =============================================================================
// subscriptions.validation.js — RESQID Super Admin
// =============================================================================

import { z } from 'zod';

// ─── Enums (mirror Prisma enums — no runtime import needed) ──────────────────
const SubscriptionStatus = z.enum(['TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED']);
const PlanType = z.enum(['BASIC', 'PREMIUM', 'CUSTOM']);

// ─── List / Filter ────────────────────────────────────────────────────────────

export const listSubscriptionsSchema = z.object({
  // Pagination
  page:   z.coerce.number().int().positive().default(1),
  limit:  z.coerce.number().int().min(1).max(100).default(20),

  // Filters
  status: SubscriptionStatus.optional(),
  plan:   PlanType.optional(),
  search: z.string().trim().max(100).optional(),  // school name / code

  // Sorting
  sortBy:  z.enum(['created_at', 'current_period_end', 'balance_due', 'total_invoiced']).default('created_at'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),

  // Special flags
  is_pilot:  z.coerce.boolean().optional(),
  overdue:   z.coerce.boolean().optional(),  // balance_due > 0
});

// ─── Update Subscription ──────────────────────────────────────────────────────
// SuperAdmin can reprice or change plan. Every change creates a new
// SchoolAgreement record — enforced in the service layer.

export const updateSubscriptionSchema = z
  .object({
    plan:                    PlanType.optional(),
    unit_price_snapshot:     z.number().int().positive().optional(),   // paise
    renewal_price_snapshot:  z.number().int().positive().optional(),   // paise
    advance_percent:         z.number().int().min(0).max(100).optional(),

    // Custom pricing — only valid when plan = CUSTOM
    is_custom_pricing:  z.boolean().optional(),
    custom_price_note:  z.string().trim().max(500).optional(),

    // Pilot controls
    is_pilot:          z.boolean().optional(),
    pilot_expires_at:  z.string().datetime().optional(),

    // Period override (rare — use with caution)
    current_period_start:  z.string().datetime().optional(),
    current_period_end:    z.string().datetime().optional(),
    trial_ends_at:         z.string().datetime().optional(),

    // Audit note (required when changing plan or price)
    note:  z.string().trim().max(500).optional(),
  })
  .refine(
    data => {
      // custom_price_note is required when enabling custom pricing
      if (data.is_custom_pricing === true && !data.custom_price_note) return false;
      return true;
    },
    { message: 'custom_price_note is required when enabling custom pricing', path: ['custom_price_note'] }
  )
  .refine(
    data => {
      // pilot_expires_at required when enabling pilot
      if (data.is_pilot === true && !data.pilot_expires_at) return false;
      return true;
    },
    { message: 'pilot_expires_at is required when enabling pilot mode', path: ['pilot_expires_at'] }
  )
  .refine(
    data => {
      // If plan is being changed or prices are being changed, note is required
      const isPriceChange =
        data.plan !== undefined ||
        data.unit_price_snapshot !== undefined ||
        data.renewal_price_snapshot !== undefined ||
        data.is_custom_pricing !== undefined;
      if (isPriceChange && !data.note) return false;
      return true;
    },
    { message: 'A note is required when changing plan or pricing', path: ['note'] }
  );

// ─── Cancel Subscription ──────────────────────────────────────────────────────

export const cancelSubscriptionSchema = z.object({
  reason: z.string().trim().min(5).max(500),
  // Set a date so school retains access until end of paid period
  cancel_at_period_end: z.boolean().default(true),
});