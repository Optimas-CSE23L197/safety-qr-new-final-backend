// =============================================================================
// orchestrator/handlers/printing.handler.js — RESQID
// Printing lifecycle management.
// All status transitions go through applyTransition().
// =============================================================================

import { prisma } from '#config/prisma.js';
import { logger } from '#config/logger.js';
import { applyTransition } from '../state/order.guards.js';
import { ORDER_STATUS } from '../state/order.states.js';

/**
 * Start printing — transition order to PRINTING.
 * Cards remain PENDING until completePrinting() confirms they're physically done.
 *
 * @param {string} orderId
 * @param {string} startedBy
 * @returns {Promise<object>}
 */
export async function startPrinting(orderId, startedBy) {
  const order = await prisma.cardOrder.findUnique({
    where: { id: orderId },
    include: {
      cards: { where: { print_status: 'PENDING' } },
      vendor: true,
    },
  });

  if (!order) throw new Error(`Order ${orderId} not found`);
  if (!order.vendor_id) throw new Error(`No vendor assigned for order ${orderId}`);

  const pendingCards = order.cards.length;
  if (pendingCards === 0) throw new Error(`No pending cards to print for order ${orderId}`);

  // Cards stay PENDING until completePrinting() — don't mark PRINTED on start
  await applyTransition({
    orderId,
    from: order.status,
    to: ORDER_STATUS.PRINTING,
    actorId: startedBy,
    actorType: 'USER',
    schoolId: order.school_id,
    meta: { vendorId: order.vendor_id, cardCount: pendingCards },
    eventPayload: { orderNumber: order.order_number, vendorName: order.vendor?.name },
  });

  logger.info({ orderId, startedBy, pendingCards }, '[printing.handler] Printing started');

  return {
    orderId,
    newStatus: ORDER_STATUS.PRINTING,
    cardsPrinting: pendingCards,
    vendor: order.vendor,
  };
}

/**
 * Mark printing as complete — transition order to PRINT_COMPLETE.
 * Marks all cards as PRINTED.
 *
 * @param {string} orderId
 * @param {string} completedBy
 * @param {string} [notes]
 * @returns {Promise<object>}
 */
export async function completePrinting(orderId, completedBy, notes = '') {
  const order = await prisma.cardOrder.findUnique({
    where: { id: orderId },
    include: { cards: true, vendor: true },
  });

  if (!order) throw new Error(`Order ${orderId} not found`);
  if (order.status !== 'PRINTING') {
    throw new Error(`Order ${orderId} is not in PRINTING state (got ${order.status})`);
  }

  const printCompleteAt = new Date();

  // Mark all cards as PRINTED
  await prisma.card.updateMany({
    where: { order_id: orderId },
    data: { print_status: 'PRINTED', printed_at: printCompleteAt },
  });

  // Record timestamp before transition so event handlers can read it
  await prisma.cardOrder.update({
    where: { id: orderId },
    data: {
      print_complete_at: printCompleteAt,
      print_complete_noted_by: completedBy,
    },
  });

  await applyTransition({
    orderId,
    from: ORDER_STATUS.PRINTING,
    to: ORDER_STATUS.PRINT_COMPLETE,
    actorId: completedBy,
    actorType: 'USER',
    schoolId: order.school_id,
    meta: { cardCount: order.cards.length, notes },
    eventPayload: { orderNumber: order.order_number },
  });

  logger.info(
    { orderId, completedBy, cardCount: order.cards.length },
    '[printing.handler] Printing complete'
  );

  return { orderId, completedAt: printCompleteAt, cardCount: order.cards.length };
}

/**
 * Report a printing issue — transitions order back to CARD_DESIGN_REVISION.
 *
 * @param {string} orderId
 * @param {{ reason: string, notes: string }} issueDetails
 * @param {string} reportedBy
 * @returns {Promise<object>}
 */
export async function reportPrintingIssue(orderId, issueDetails, reportedBy) {
  const order = await prisma.cardOrder.findUnique({
    where: { id: orderId },
    select: { id: true, status: true, school_id: true, order_number: true },
  });

  if (!order) throw new Error(`Order ${orderId} not found`);

  // Save vendor notes before transition
  await prisma.cardOrder.update({
    where: { id: orderId },
    data: {
      vendor_notes: issueDetails.notes ?? null,
      admin_notes: `Printing issue reported: ${issueDetails.reason}`,
    },
  });

  await applyTransition({
    orderId,
    from: order.status,
    to: ORDER_STATUS.CARD_DESIGN_REVISION,
    actorId: reportedBy,
    actorType: 'USER',
    schoolId: order.school_id,
    meta: { issueDetails },
    eventPayload: { orderNumber: order.order_number, reason: issueDetails.reason },
  });

  logger.info(
    { orderId, reportedBy, reason: issueDetails.reason },
    '[printing.handler] Printing issue reported'
  );

  return {
    orderId,
    previousStatus: order.status,
    newStatus: ORDER_STATUS.CARD_DESIGN_REVISION,
    issue: issueDetails,
  };
}

/**
 * Get a card print status summary for an order.
 * Uses prisma.card.groupBy — NOT groupBy inside include (invalid Prisma syntax).
 *
 * @param {string} orderId
 * @returns {Promise<object|null>}
 */
export async function getPrintingStatus(orderId) {
  const order = await prisma.cardOrder.findUnique({
    where: { id: orderId },
    select: { id: true, order_number: true, status: true, print_complete_at: true },
  });

  if (!order) return null;

  // Correct groupBy usage — standalone query, never inside include
  const groups = await prisma.card.groupBy({
    by: ['print_status'],
    where: { order_id: orderId },
    _count: { id: true },
  });

  const statusCounts = { PENDING: 0, PRINTED: 0, REPRINTED: 0, FAILED: 0 };
  for (const group of groups) {
    statusCounts[group.print_status] = group._count.id;
  }

  return {
    orderId: order.id,
    orderNumber: order.order_number,
    status: order.status,
    printCompleteAt: order.print_complete_at,
    cards: statusCounts,
    totalCards: Object.values(statusCounts).reduce((a, b) => a + b, 0),
  };
}
