// =============================================================================
// orchestrator/policies/cancellation.policy.js — RESQID PHASE 1
// Enforces business rules around order cancellation.
// =============================================================================

import { prisma } from '#config/prisma.js';
import { logger } from '#config/logger.js';
import { ORDER_STATUS } from '../state/order.states.js';

// States from which cancellation is allowed
const CANCELLABLE_STATES = new Set([
  ORDER_STATUS.PENDING,
  ORDER_STATUS.PARTIAL_PAYMENT_CONFIRMED,
  ORDER_STATUS.PARTIAL_INVOICE_GENERATED,
  ORDER_STATUS.TOKEN_GENERATING,
  ORDER_STATUS.TOKEN_COMPLETE,
]);

/**
 * Evaluate whether an order can be cancelled.
 *
 * Checks:
 *  1. Current state allows cancellation
 *  2. No tokens generated (or tokens not yet activated)
 *  3. Not shipped
 *  4. Printing not started
 *
 * @param {string} orderId
 * @param {object} actor - { id, role }
 * @returns {{ allowed: boolean, reason?: string }}
 */
export async function evaluateCancellation(orderId, actor) {
  // Rule 1: Only super admin can cancel in Phase 1
  if (!actor || actor.role !== 'SUPER_ADMIN') {
    return { allowed: false, reason: 'Only Super Admin can cancel an order' };
  }

  // Rule 2: Fetch order with related data
  const order = await prisma.cardOrder.findUnique({
    where: { id: orderId },
    include: {
      tokens: { select: { id: true, status: true } }, // ✅ fetch all tokens
      cards: { where: { print_status: 'PRINTED' }, select: { id: true, print_status: true } },
      shipment: { select: { status: true } },
    },
  });

  if (!order) {
    return { allowed: false, reason: 'Order not found' };
  }

  // Rule 3: Check if current state allows cancellation
  if (!CANCELLABLE_STATES.has(order.status)) {
    return {
      allowed: false,
      reason: `Order cannot be cancelled from state: ${order.status}`,
    };
  }

  // Rule 4: Check if any tokens are already ACTIVE (issued to parents)
  const hasActiveTokens = order.tokens.some(t => t.status === 'ACTIVE');
  if (hasActiveTokens) {
    return {
      allowed: false,
      reason: 'Cannot cancel order with active tokens already issued to parents',
    };
  }

  // Rule 5: Check if printing has started
  const hasPrintedCards = order.cards.some(c => c.print_status === 'PRINTED');
  if (hasPrintedCards) {
    return {
      allowed: false,
      reason: 'Cannot cancel order after printing has started',
    };
  }

  // Rule 6: Check if shipped
  if (
    order.shipment &&
    ['PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY'].includes(order.shipment.status)
  ) {
    return {
      allowed: false,
      reason: 'Cannot cancel order after shipment has been dispatched',
    };
  }

  return { allowed: true };
}

/**
 * Run cancellation guards (simplified for Phase 1)
 * @param {string} orderId
 * @returns {Promise<{ pass: boolean, reason?: string }>}
 */
export async function runCancellationGuards(orderId) {
  try {
    const order = await prisma.cardOrder.findUnique({
      where: { id: orderId },
      include: {
        payments: { where: { status: 'SUCCESS' }, select: { amount: true } },
        tokens: { where: { status: 'ACTIVE' }, select: { id: true } },
        cards: { where: { print_status: 'PRINTED' }, select: { id: true } },
        shipment: { select: { status: true } },
      },
    });

    if (!order) {
      return { pass: false, reason: 'Order not found' };
    }

    // Check for advance payment (refund would be needed)
    const hasAdvancePayment = order.payments.length > 0 && order.payments[0].amount > 0;
    if (hasAdvancePayment) {
      return { pass: false, reason: 'Advance payment received — refund required' };
    }

    // Check for active tokens
    if (order.tokens.length > 0) {
      return { pass: false, reason: 'Tokens already generated' };
    }

    // Check for printed cards
    if (order.cards.length > 0) {
      return { pass: false, reason: 'Cards already printed' };
    }

    // Check shipment status
    if (order.shipment && order.shipment.status !== 'PENDING') {
      return { pass: false, reason: 'Shipment already in progress' };
    }

    return { pass: true };
  } catch (error) {
    logger.error({ error: error.message, orderId }, '[cancellation.policy] Guard check failed');
    return { pass: false, reason: 'Internal error checking cancellation guards' };
  }
}
