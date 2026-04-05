// =============================================================================
// subscriptions.service.js — RESQID Super Admin
// Business logic — no Prisma, no HTTP. Calls repository only.
// =============================================================================

import { ApiError } from '#shared/response/ApiError.js';
import { parseOffsetParams, buildOffsetMeta } from '#shared/response/paginate.js';
import { logger } from '#config/logger.js';
import * as SubscriptionRepository from './subscriptions.repository.js';

// ─── List ─────────────────────────────────────────────────────────────────────

/**
 * List subscriptions with filters and pagination
 * @param {object} query  — validated query params from listSubscriptionsSchema
 */
export async function listSubscriptions(query) {
  const { page, limit, status, plan, search, is_pilot, overdue, sortBy, sortDir } = query;

  const { skip, take } = parseOffsetParams({ page, limit });

  const { data, total } = await SubscriptionRepository.findSubscriptions({
    status,
    plan,
    search,
    is_pilot,
    overdue,
    sortBy,
    sortDir,
    skip,
    take,
  });

  return {
    data,
    meta: buildOffsetMeta(total, page, limit),
  };
}

// ─── Get Single ───────────────────────────────────────────────────────────────

/**
 * Fetch a single subscription by ID, with full nested detail
 */
export async function getSubscription(id) {
  const subscription = await SubscriptionRepository.findSubscriptionById(id);

  if (!subscription) {
    throw ApiError.notFound('Subscription');
  }

  return subscription;
}

// ─── Update ───────────────────────────────────────────────────────────────────

/**
 * Update a subscription's plan, pricing, or period settings.
 * Creates a SchoolAgreement audit trail whenever plan or price changes.
 *
 * @param {string} id             — subscription ID
 * @param {object} body           — validated body from updateSubscriptionSchema
 * @param {object} actorContext   — { actorId, ip }
 */
export async function updateSubscription(id, body, actorContext) {
  const subscription = await SubscriptionRepository.findSubscriptionById(id);
  if (!subscription) throw ApiError.notFound('Subscription');

  // Guard: Cannot update a CANCELED or EXPIRED subscription
  if (['CANCELED', 'EXPIRED'].includes(subscription.status)) {
    throw ApiError.badRequest(
      `Cannot update a subscription with status '${subscription.status}'`
    );
  }

  // Guard: CUSTOM plan must have custom pricing enabled
  const targetPlan = body.plan ?? subscription.plan;
  if (targetPlan === 'CUSTOM' && body.is_custom_pricing === false) {
    throw ApiError.badRequest('CUSTOM plan requires is_custom_pricing to be true');
  }

  // Determine if this is a pricing/plan change that requires an agreement record
  const isPricingChange =
    body.plan !== undefined ||
    body.unit_price_snapshot !== undefined ||
    body.renewal_price_snapshot !== undefined ||
    body.is_custom_pricing !== undefined;

  // Build update payload — strip fields not in the Prisma model (like `note`)
  const { note, ...updateFields } = body;

  // Convert datetime strings to Date objects
  const updateData = {};
  for (const [key, val] of Object.entries(updateFields)) {
    if (val === undefined) continue;

    const dateFields = ['pilot_expires_at', 'current_period_start', 'current_period_end', 'trial_ends_at'];
    updateData[key] = dateFields.includes(key) && typeof val === 'string' ? new Date(val) : val;
  }

  // Set custom_approved_by and custom_approved_at when approving custom pricing
  if (body.is_custom_pricing === true) {
    updateData.custom_approved_by = actorContext.actorId;
    updateData.custom_approved_at = new Date();
  }

  const updated = await SubscriptionRepository.updateSubscription(id, updateData);

  // Create agreement audit trail for any pricing/plan change
  if (isPricingChange) {
    await SubscriptionRepository.createAgreement({
      school_id:       subscription.school.id,
      subscription_id: id,
      agreed_by:       actorContext.actorId,
      agreed_via:      'DASHBOARD',
      notes:           note ?? `Plan/pricing updated by super admin`,
      ip_address:      actorContext.ip,
    });

    logger.info(
      { subscriptionId: id, actorId: actorContext.actorId, changes: Object.keys(updateData) },
      'Subscription pricing/plan updated — agreement recorded'
    );
  }

  return updated;
}

// ─── Cancel ───────────────────────────────────────────────────────────────────

/**
 * Cancel a subscription. Creates an agreement record as audit trail.
 *
 * @param {string} id           — subscription ID
 * @param {object} body         — { reason, cancel_at_period_end }
 * @param {object} actorContext — { actorId, ip }
 */
export async function cancelSubscription(id, body, actorContext) {
  const subscription = await SubscriptionRepository.findSubscriptionById(id);
  if (!subscription) throw ApiError.notFound('Subscription');

  if (subscription.status === 'CANCELED') {
    throw ApiError.conflict('Subscription is already canceled');
  }

  if (subscription.status === 'EXPIRED') {
    throw ApiError.badRequest('Cannot cancel an expired subscription');
  }

  const canceled = await SubscriptionRepository.cancelSubscription(id, {
    cancelAtPeriodEnd: body.cancel_at_period_end,
  });

  // Record the cancellation as an agreement event
  await SubscriptionRepository.createAgreement({
    school_id:       subscription.school.id,
    subscription_id: id,
    agreed_by:       actorContext.actorId,
    agreed_via:      'DASHBOARD',
    notes:           `Canceled by super admin. Reason: ${body.reason}`,
    ip_address:      actorContext.ip,
  });

  logger.info(
    { subscriptionId: id, actorId: actorContext.actorId, reason: body.reason },
    'Subscription canceled'
  );

  return canceled;
}

// ─── Stats ───────────────────────────────────────────────────────────────────

/**
 * Get aggregated subscription stats for the dashboard summary row
 */
export async function getSubscriptionStats() {
  const stats = await SubscriptionRepository.getSubscriptionStats();
  return stats;
}