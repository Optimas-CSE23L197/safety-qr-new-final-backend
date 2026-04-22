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
 *  1. Actor authorization (Super Admin only in Phase 1)
 *  2. Current state allows cancellation
 *  3. No advance payment received (or refund handled)
 *  4. No active tokens issued to parents
 *  5. Printing not started
 *  6. Not shipped
 *
 * @param {string} orderId
 * @param {object} actor - { id, role }
 * @returns {Promise<{ allowed: boolean, reason?: string }>}
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
      tokens: { select: { id: true, status: true } },
      cards: { where: { print_status: 'PRINTED' }, select: { id: true, print_status: true } },
      shipment: { select: { status: true } },
      payments: { where: { status: 'SUCCESS' }, select: { id: true, amount: true } },
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

  // Rule 4: Check for advance payment (refund would be needed)
  const hasAdvancePayment = order.payments.length > 0;
  if (hasAdvancePayment) {
    return {
      allowed: false,
      reason: 'Advance payment received — refund required before cancellation',
    };
  }

  // Rule 5: Check if any tokens are already ACTIVE (issued to parents)
  const hasActiveTokens = order.tokens.some(t => t.status === 'ACTIVE');
  if (hasActiveTokens) {
    return {
      allowed: false,
      reason: 'Cannot cancel order with active tokens already issued to parents',
    };
  }

  // Rule 6: Check if printing has started
  const hasPrintedCards = order.cards.some(c => c.print_status === 'PRINTED');
  if (hasPrintedCards) {
    return {
      allowed: false,
      reason: 'Cannot cancel order after printing has started',
    };
  }

  // Rule 7: Check if shipped
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
