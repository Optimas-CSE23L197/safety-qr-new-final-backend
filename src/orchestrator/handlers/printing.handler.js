// =============================================================================
// handlers/printing.handler.js
// Business logic for printing management.
// =============================================================================

import { prisma } from '#config/prisma.js';

/**
 * Start printing for an order
 */
export async function startPrinting(orderId, startedBy) {
  const order = await prisma.cardOrder.findUnique({
    where: { id: orderId },
    include: {
      cards: {
        where: { print_status: 'PENDING' },
      },
      vendor: true,
    },
  });

  if (!order) {
    throw new Error(`Order ${orderId} not found`);
  }

  if (!order.vendor_id) {
    throw new Error(`No vendor assigned for order ${orderId}`);
  }

  const pendingCards = order.cards.length;

  if (pendingCards === 0) {
    throw new Error(`No pending cards to print for order ${orderId}`);
  }

  // Update order status
  const updatedOrder = await prisma.cardOrder.update({
    where: { id: orderId },
    data: {
      status: 'PRINTING',
      print_complete_at: null,
      status_changed_by: startedBy,
      status_changed_at: new Date(),
    },
  });

  // Update all cards to printing status
  await prisma.card.updateMany({
    where: { order_id: orderId, print_status: 'PENDING' },
    data: { print_status: 'PRINTED' },
  });

  // Create status log
  await prisma.orderStatusLog.create({
    data: {
      order_id: orderId,
      from_status: order.status,
      to_status: 'PRINTING',
      changed_by: startedBy,
      note: `Printing started with vendor: ${order.vendor?.name}`,
      metadata: {
        vendorId: order.vendor_id,
        cardCount: pendingCards,
      },
    },
  });

  return {
    order: updatedOrder,
    cardsPrinting: pendingCards,
    vendor: order.vendor,
  };
}

/**
 * Mark printing as complete
 */
export async function completePrinting(orderId, completedBy, notes = '') {
  const order = await prisma.cardOrder.findUnique({
    where: { id: orderId },
    include: {
      cards: true,
      vendor: true,
    },
  });

  if (!order) {
    throw new Error(`Order ${orderId} not found`);
  }

  if (order.status !== 'PRINTING') {
    throw new Error(`Order ${orderId} is not in PRINTING state`);
  }

  const printCompleteAt = new Date();

  // Update order
  const updatedOrder = await prisma.cardOrder.update({
    where: { id: orderId },
    data: {
      status: 'PRINT_COMPLETE',
      print_complete_at: printCompleteAt,
      print_complete_noted_by: completedBy,
      status_changed_by: completedBy,
      status_changed_at: printCompleteAt,
    },
  });

  // Update all cards
  await prisma.card.updateMany({
    where: { order_id: orderId },
    data: { print_status: 'PRINTED' },
  });

  // Create status log
  await prisma.orderStatusLog.create({
    data: {
      order_id: orderId,
      from_status: 'PRINTING',
      to_status: 'PRINT_COMPLETE',
      changed_by: completedBy,
      note: notes || 'Printing completed',
      metadata: {
        vendorId: order.vendor_id,
        cardCount: order.cards.length,
        completedAt: printCompleteAt,
      },
    },
  });

  return {
    order: updatedOrder,
    completedAt: printCompleteAt,
    cardCount: order.cards.length,
  };
}

/**
 * Report printing issue
 */
export async function reportPrintingIssue(orderId, issueDetails, reportedBy) {
  const order = await prisma.cardOrder.findUnique({
    where: { id: orderId },
  });

  if (!order) {
    throw new Error(`Order ${orderId} not found`);
  }

  // Update order with issue
  await prisma.cardOrder.update({
    where: { id: orderId },
    data: {
      status: 'CARD_DESIGN_REVISION',
      vendor_notes: issueDetails.notes,
      admin_notes: `Printing issue reported: ${issueDetails.reason}`,
      status_changed_by: reportedBy,
      status_changed_at: new Date(),
    },
  });

  // Create status log
  await prisma.orderStatusLog.create({
    data: {
      order_id: orderId,
      from_status: order.status,
      to_status: 'CARD_DESIGN_REVISION',
      changed_by: reportedBy,
      note: `Printing issue: ${issueDetails.reason}`,
      metadata: {
        issueDetails,
      },
    },
  });

  return {
    orderId,
    previousStatus: order.status,
    newStatus: 'CARD_DESIGN_REVISION',
    issue: issueDetails,
  };
}

/**
 * Get printing status summary
 */
export async function getPrintingStatus(orderId) {
  const order = await prisma.cardOrder.findUnique({
    where: { id: orderId },
    include: {
      cards: {
        groupBy: ['print_status'],
        _count: true,
      },
    },
  });

  if (!order) {
    return null;
  }

  const statusCounts = {
    PENDING: 0,
    PRINTED: 0,
    REPRINTED: 0,
    FAILED: 0,
  };

  for (const group of order.cards) {
    statusCounts[group.print_status] = group._count;
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
