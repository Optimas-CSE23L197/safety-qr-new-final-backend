// =============================================================================
// handlers/payment.handler.js
// Business logic for payment processing.
// =============================================================================

import { prisma } from '#config/prisma.js';
import { logger } from '#config/logger.js';

/**
 * Generate unique invoice number
 */
export async function generateInvoiceNumber(schoolId, type) {
  const prefix = type === 'ADVANCE' ? 'INV-ADV' : 'INV-BAL';
  const year = new Date().getFullYear();

  const lastInvoice = await prisma.invoice.findFirst({
    where: {
      school_id: schoolId,
      invoice_number: {
        startsWith: `${prefix}-${year}`,
      },
    },
    orderBy: { invoice_number: 'desc' },
    select: { invoice_number: true },
  });

  let sequence = 1;
  if (lastInvoice) {
    const match = lastInvoice.invoice_number.match(/\d+$/);
    if (match) {
      sequence = parseInt(match[0], 10) + 1;
    }
  }

  return `${prefix}-${year}-${String(sequence).padStart(4, '0')}`;
}

/**
 * Create advance payment invoice
 */
export async function createAdvanceInvoice(orderId) {
  const order = await prisma.cardOrder.findUnique({
    where: { id: orderId },
    include: {
      subscription: true,
      school: {
        select: {
          id: true,
          name: true,
          email: true,
          address: true,
          gstin: true,
          pricing_tier: true,
        },
      },
    },
  });

  if (!order) {
    throw new Error(`Order ${orderId} not found`);
  }

  if (!order.subscription) {
    throw new Error(`Order ${orderId} has no subscription`);
  }

  // Calculate advance amount (50% of grand_total)
  const advanceAmount = Math.floor(order.subscription.grand_total / 2);
  const taxAmount = Math.floor(order.subscription.tax_amount / 2);
  const amount = advanceAmount - taxAmount;

  const invoiceNumber = await generateInvoiceNumber(order.school_id, 'ADVANCE');

  // Create invoice
  const invoice = await prisma.invoice.create({
    data: {
      school_id: order.school_id,
      subscription_id: order.subscription_id,
      invoice_number: invoiceNumber,
      invoice_type: 'ADVANCE',
      student_count: order.card_count,
      unit_price: order.subscription.unit_price,
      amount: amount,
      tax_amount: taxAmount,
      total_amount: advanceAmount,
      status: 'ISSUED',
      issued_at: new Date(),
      due_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      notes: `50% advance payment for order ${order.order_number}`,
    },
  });

  // Update order with invoice
  await prisma.cardOrder.update({
    where: { id: orderId },
    data: {
      advance_invoice_id: invoice.id,
      advance_amount: advanceAmount,
    },
  });

  return {
    invoice,
    amount: advanceAmount,
    dueDate: invoice.due_at,
  };
}

/**
 * Create balance payment invoice
 */
export async function createBalanceInvoice(orderId) {
  const order = await prisma.cardOrder.findUnique({
    where: { id: orderId },
    include: {
      subscription: true,
      school: true,
    },
  });

  if (!order) {
    throw new Error(`Order ${orderId} not found`);
  }

  if (!order.subscription) {
    throw new Error(`Order ${orderId} has no subscription`);
  }

  const balanceAmount = order.subscription.balance_due;

  if (balanceAmount <= 0) {
    return { skip: true, balanceAmount: 0 };
  }

  const taxAmount = Math.floor(order.subscription.tax_amount / 2);
  const amount = balanceAmount - taxAmount;

  const invoiceNumber = await generateInvoiceNumber(order.school_id, 'BALANCE');

  const invoice = await prisma.invoice.create({
    data: {
      school_id: order.school_id,
      subscription_id: order.subscription_id,
      invoice_number: invoiceNumber,
      invoice_type: 'BALANCE',
      student_count: order.card_count,
      unit_price: order.subscription.unit_price,
      amount: amount,
      tax_amount: taxAmount,
      total_amount: balanceAmount,
      status: 'ISSUED',
      issued_at: new Date(),
      due_at: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
      notes: `Balance payment for order ${order.order_number}`,
    },
  });

  await prisma.cardOrder.update({
    where: { id: orderId },
    data: {
      balance_invoice_id: invoice.id,
      balance_amount: balanceAmount,
      balance_due_at: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
    },
  });

  return {
    invoice,
    amount: balanceAmount,
    dueDate: invoice.due_at,
  };
}

/**
 * Record payment transaction
 */
export async function recordPayment(orderId, paymentData, actorId) {
  const order = await prisma.cardOrder.findUnique({
    where: { id: orderId },
    select: { school_id: true, subscription_id: true, payment_status: true },
  });

  if (!order) {
    throw new Error(`Order ${orderId} not found`);
  }

  // Create payment record
  const payment = await prisma.payment.create({
    data: {
      school_id: order.school_id,
      subscription_id: order.subscription_id,
      order_id: orderId,
      amount: paymentData.amount,
      status: 'SUCCESS',
      provider: paymentData.provider || 'manual',
      provider_ref: paymentData.providerRef,
      payment_mode: paymentData.paymentMode || 'BANK_TRANSFER',
      is_advance: paymentData.isAdvance || true,
      metadata: {
        reference: paymentData.reference,
        notes: paymentData.notes,
        processedBy: actorId,
      },
    },
  });

  // Update order payment status
  const newPaymentStatus = order.payment_status === 'PARTIALLY_PAID' ? 'PAID' : 'PARTIALLY_PAID';

  await prisma.cardOrder.update({
    where: { id: orderId },
    data: {
      payment_status: newPaymentStatus,
      ...(paymentData.isAdvance
        ? { advance_paid_at: new Date() }
        : { balance_paid_at: new Date() }),
    },
  });

  // Update subscription if exists
  if (order.subscription_id) {
    await prisma.subscription.update({
      where: { id: order.subscription_id },
      data: {
        advance_paid: paymentData.isAdvance ? { increment: paymentData.amount } : undefined,
        balance_due: { decrement: paymentData.amount },
        fully_paid_at: newPaymentStatus === 'PAID' ? new Date() : undefined,
      },
    });
  }

  // Update invoice if linked
  if (paymentData.invoiceId) {
    await prisma.invoice.update({
      where: { id: paymentData.invoiceId },
      data: {
        status: 'PAID',
        paid_at: new Date(),
      },
    });
  }

  return payment;
}

/**
 * Verify payment from webhook
 */
export async function verifyPayment(provider, providerRef, expectedAmount, orderId) {
  // In production, this would call Razorpay API to verify
  // For now, return true
  logger.info({
    msg: 'Verifying payment',
    provider,
    providerRef,
    expectedAmount,
    orderId,
  });

  return { verified: true };
}

/**
 * Get payment summary for order
 */
export async function getPaymentSummary(orderId) {
  const order = await prisma.cardOrder.findUnique({
    where: { id: orderId },
    include: {
      payments: {
        orderBy: { created_at: 'desc' },
      },
      advanceInvoice: true,
      balanceInvoice: true,
      subscription: {
        select: {
          grand_total: true,
          advance_paid: true,
          balance_due: true,
        },
      },
    },
  });

  if (!order) {
    return null;
  }

  const totalPaid = order.payments.reduce((sum, p) => sum + p.amount, 0);

  return {
    orderId: order.id,
    orderNumber: order.order_number,
    subscriptionTotal: order.subscription?.grand_total || 0,
    advanceAmount: order.advance_amount,
    balanceAmount: order.balance_amount,
    totalPaid,
    remaining: (order.subscription?.grand_total || 0) - totalPaid,
    payments: order.payments.map(p => ({
      id: p.id,
      amount: p.amount,
      status: p.status,
      provider: p.provider,
      providerRef: p.provider_ref,
      createdAt: p.created_at,
      isAdvance: p.is_advance,
    })),
    advanceInvoice: order.advanceInvoice,
    balanceInvoice: order.balanceInvoice,
  };
}
