// =============================================================================
// handlers/cancel.handler.js
// Business logic for order cancellation.
// =============================================================================

import { prisma } from '#config/database/prisma.js';

/**
 * Cancel order and perform all cleanup
 */
export async function cancelOrder(orderId, cancelledBy, reason, notes = '') {
  const order = await prisma.cardOrder.findUnique({
    where: { id: orderId },
    include: {
      tokens: true,
      cards: true,
      payments: true,
      advanceInvoice: true,
      balanceInvoice: true,
      subscription: true,
    },
  });

  if (!order) {
    throw new Error(`Order ${orderId} not found`);
  }

  // Check if order can be cancelled
  const cancellationChecks = await validateCancellation(orderId);
  if (!cancellationChecks.canCancel) {
    throw new Error(cancellationChecks.reason);
  }

  const cancelledAt = new Date();

  // Revoke all tokens
  if (order.tokens.length > 0) {
    await prisma.token.updateMany({
      where: { order_id: orderId },
      data: {
        status: 'REVOKED',
        revoked_at: cancelledAt,
      },
    });
  }

  // Cancel all cards
  if (order.cards.length > 0) {
    await prisma.card.updateMany({
      where: { order_id: orderId },
      data: {
        print_status: 'FAILED',
      },
    });
  }

  // Cancel invoices
  if (order.advance_invoice_id) {
    await prisma.invoice.update({
      where: { id: order.advance_invoice_id },
      data: { status: 'CANCELLED' },
    });
  }

  if (order.balance_invoice_id) {
    await prisma.invoice.update({
      where: { id: order.balance_invoice_id },
      data: { status: 'CANCELLED' },
    });
  }

  // Update subscription if any payment was made
  if (order.subscription_id && order.payments.length > 0) {
    const totalPaid = order.payments.reduce((sum, p) => sum + p.amount, 0);
    await prisma.subscription.update({
      where: { id: order.subscription_id },
      data: {
        balance_due: { increment: totalPaid }, // Refund tracking
      },
    });
  }

  // Update order
  const updatedOrder = await prisma.cardOrder.update({
    where: { id: orderId },
    data: {
      status: 'CANCELLED',
      status_note: reason,
      status_changed_by: cancelledBy,
      status_changed_at: cancelledAt,
    },
  });

  // Create status log
  await prisma.orderStatusLog.create({
    data: {
      order_id: orderId,
      from_status: order.status,
      to_status: 'CANCELLED',
      changed_by: cancelledBy,
      note: reason,
      metadata: {
        notes,
        cancelledAt,
        tokensRevoked: order.tokens.length,
        cardsCancelled: order.cards.length,
        refundRequired: order.payments.length > 0,
      },
    },
  });

  // Create audit log
  await prisma.auditLog.create({
    data: {
      school_id: order.school_id,
      actor_id: cancelledBy,
      actor_type: 'SUPER_ADMIN',
      action: 'ORDER_CANCELLED',
      entity: 'CardOrder',
      entity_id: orderId,
      old_value: { status: order.status, paymentStatus: order.payment_status },
      new_value: { status: 'CANCELLED', reason },
    },
  });

  return {
    order: updatedOrder,
    cancelledAt,
    tokensRevoked: order.tokens.length,
    cardsCancelled: order.cards.length,
    refundRequired: order.payments.length > 0,
    totalPaid: order.payments.reduce((sum, p) => sum + p.amount, 0),
  };
}

/**
 * Validate if order can be cancelled
 */
export async function validateCancellation(orderId) {
  const order = await prisma.cardOrder.findUnique({
    where: { id: orderId },
    include: {
      tokens: { take: 1 },
      cards: { take: 1 },
      shipment: true,
    },
  });

  if (!order) {
    return { canCancel: false, reason: 'Order not found' };
  }

  // Already cancelled
  if (order.status === 'CANCELLED') {
    return { canCancel: false, reason: 'Order is already cancelled' };
  }

  // Completed orders cannot be cancelled
  if (order.status === 'COMPLETED') {
    return { canCancel: false, reason: 'Completed orders cannot be cancelled' };
  }

  // Check if tokens generated
  if (order.tokens.length > 0 && order.status !== 'PENDING' && order.status !== 'CONFIRMED') {
    return { canCancel: false, reason: 'Tokens have already been generated' };
  }

  // Check if printing started
  if (order.status === 'PRINTING' || order.status === 'PRINT_COMPLETE') {
    return { canCancel: false, reason: 'Printing has already started' };
  }

  // Check if shipped
  if (order.shipment && order.shipment.status !== 'PENDING') {
    return { canCancel: false, reason: 'Order has already been shipped' };
  }

  // Check if advance payment received
  if (order.payment_status === 'PARTIALLY_PAID' || order.payment_status === 'PAID') {
    // Can still cancel but will require refund
    return {
      canCancel: true,
      requiresRefund: true,
      reason: 'Advance payment received, refund required',
    };
  }

  return { canCancel: true, requiresRefund: false };
}

/**
 * Process refund for cancelled order
 */
export async function processRefund(orderId, processedBy, notes = '') {
  const order = await prisma.cardOrder.findUnique({
    where: { id: orderId },
    include: {
      payments: true,
    },
  });

  if (!order) {
    throw new Error(`Order ${orderId} not found`);
  }

  if (order.status !== 'CANCELLED') {
    throw new Error(`Order ${orderId} is not cancelled`);
  }

  const totalPaid = order.payments.reduce((sum, p) => sum + p.amount, 0);

  if (totalPaid === 0) {
    return { refunded: false, reason: 'No payment to refund' };
  }

  // In production, this would call Razorpay refund API
  const refundedAt = new Date();

  // Update payments as refunded
  await prisma.payment.updateMany({
    where: { order_id: orderId, status: 'SUCCESS' },
    data: { status: 'REFUNDED' },
  });

  // Update order
  await prisma.cardOrder.update({
    where: { id: orderId },
    data: {
      payment_status: 'REFUNDED',
      admin_notes: `Refund processed: ${notes}`,
    },
  });

  // Create status log
  await prisma.orderStatusLog.create({
    data: {
      order_id: orderId,
      from_status: 'CANCELLED',
      to_status: 'REFUNDED',
      changed_by: processedBy,
      note: `Refund processed: ${notes}`,
      metadata: {
        refundedAt,
        totalRefunded: totalPaid,
      },
    },
  });

  return {
    refunded: true,
    refundedAt,
    totalRefunded: totalPaid,
    paymentsRefunded: order.payments.length,
  };
}
