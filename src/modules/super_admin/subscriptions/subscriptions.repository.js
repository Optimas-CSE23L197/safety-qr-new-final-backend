// =============================================================================
// subscriptions.repository.js — RESQID Super Admin
// Pure Prisma queries — no business logic, no HTTP concerns
// =============================================================================

import { prisma } from '#config/prisma.js';

// ─── Select Shapes ────────────────────────────────────────────────────────────

// List row — enough to render the dashboard table
const LIST_SELECT = {
  id: true,
  plan: true,
  status: true,
  unit_price_snapshot: true,
  renewal_price_snapshot: true,
  advance_percent: true,
  is_custom_pricing: true,
  is_pilot: true,
  pilot_expires_at: true,
  student_count: true,
  active_card_count: true,
  grand_total: true,
  total_invoiced: true,
  total_received: true,
  balance_due: true,
  current_period_start: true,
  current_period_end: true,
  trial_ends_at: true,
  created_at: true,
  updated_at: true,
  school: {
    select: {
      id: true,
      name: true,
      code: true,
      city: true,
      state: true,
      school_type: true,
      is_active: true,
    },
  },
};

// Full detail — single subscription page
const DETAIL_SELECT = {
  ...LIST_SELECT,
  fully_paid_at: true,
  pilot_converted_at: true,
  custom_price_note: true,
  custom_approved_by: true,
  custom_approved_at: true,
  current_period_end: true,
  school: {
    select: {
      id: true,
      name: true,
      code: true,
      city: true,
      state: true,
      school_type: true,
      email: true,
      phone: true,
      is_active: true,
      setup_status: true,
      onboarded_at: true,
    },
  },
  invoices: {
    select: {
      id: true,
      invoice_number: true,
      invoice_type: true,
      status: true,
      amount: true,
      tax_amount: true,
      total_amount: true,
      issued_at: true,
      due_at: true,
      paid_at: true,
    },
    orderBy: { issued_at: 'desc' },
    take: 10,
  },
  payments: {
    select: {
      id: true,
      amount: true,
      status: true,
      payment_mode: true,
      payment_ref: true,
      recorded_by: true,
      created_at: true,
    },
    orderBy: { created_at: 'desc' },
    take: 10,
  },
  agreements: {
    select: {
      id: true,
      agreed_at: true,
      agreed_by: true,
      agreed_via: true,
      document_url: true,
    },
    orderBy: { agreed_at: 'desc' },
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build Prisma WHERE clause from validated filter params
 */
function buildWhere({ status, plan, search, is_pilot, overdue }) {
  const where = {};

  if (status) where.status = status;
  if (plan)   where.plan   = plan;

  if (is_pilot !== undefined) where.is_pilot = is_pilot;

  if (overdue === true) where.balance_due = { gt: 0 };

  if (search) {
    where.school = {
      OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } },
      ],
    };
  }

  return where;
}

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * List subscriptions with filters, sorting, and pagination
 */
export async function findSubscriptions({ status, plan, search, is_pilot, overdue, sortBy, sortDir, skip, take }) {
  const where = buildWhere({ status, plan, search, is_pilot, overdue });

  const [data, total] = await Promise.all([
    prisma.subscription.findMany({
      where,
      select: LIST_SELECT,
      orderBy: { [sortBy]: sortDir },
      skip,
      take,
    }),
    prisma.subscription.count({ where }),
  ]);

  return { data, total };
}

/**
 * Get a single subscription by ID with full detail
 */
export async function findSubscriptionById(id) {
  return prisma.subscription.findUnique({
    where: { id },
    select: DETAIL_SELECT,
  });
}

/**
 * Update subscription fields
 */
export async function updateSubscription(id, data) {
  return prisma.subscription.update({
    where: { id },
    data,
    select: LIST_SELECT,
  });
}

/**
 * Cancel a subscription — sets status to CANCELED and optionally
 * preserves access until end of current period
 */
export async function cancelSubscription(id, { cancelAtPeriodEnd }) {
  // If cancel_at_period_end = true → keep status as-is until cron flips it at period end
  // If cancel_at_period_end = false → cancel immediately
  const data = cancelAtPeriodEnd
    ? { status: 'CANCELED' }          // immediate
    : { status: 'CANCELED' };         // same SQL — period enforcement is in service

  return prisma.subscription.update({
    where: { id },
    data,
    select: LIST_SELECT,
  });
}

/**
 * Stats aggregation for the dashboard summary cards
 * Uses groupBy for status counts and aggregate for MRR
 */
export async function getSubscriptionStats() {
  const [statusGroups, mrrResult, pilotCount] = await Promise.all([
    // Count by status
    prisma.subscription.groupBy({
      by: ['status'],
      _count: { id: true },
    }),

    // MRR = sum of (unit_price_snapshot × active_card_count) for ACTIVE subs
    // Prisma can't do column × column in aggregate, so we fetch the raw numbers
    prisma.subscription.findMany({
      where: { status: 'ACTIVE' },
      select: { unit_price_snapshot: true, active_card_count: true, student_count: true },
    }),

    // Pilot subscriptions count
    prisma.subscription.count({ where: { is_pilot: true, status: { not: 'CANCELED' } } }),
  ]);

  // Compute MRR from fetched rows (unit_price is per card per year → divide by 12 for monthly)
  // If active_card_count is 0, fall back to student_count
  const mrr = mrrResult.reduce((acc, sub) => {
    const cards = sub.active_card_count || sub.student_count;
    return acc + Math.round((sub.unit_price_snapshot * cards) / 12);
  }, 0);

  // Build status counts map
  const counts = {
    TRIALING:  0,
    ACTIVE:    0,
    PAST_DUE:  0,
    CANCELED:  0,
    EXPIRED:   0,
  };
  for (const g of statusGroups) {
    counts[g.status] = g._count.id;
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  return { mrr, counts, total, pilotCount };
}

/**
 * Create a SchoolAgreement record (used on plan/price change)
 */
export async function createAgreement({ school_id, subscription_id, agreed_by, agreed_via, notes, ip_address }) {
  return prisma.schoolAgreement.create({
    data: {
      school_id,
      subscription_id,
      agreed_by,
      agreed_via,
      notes,
      ip_address: ip_address ?? null,
    },
  });
}