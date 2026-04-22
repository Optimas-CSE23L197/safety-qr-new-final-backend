// =============================================================================
// orchestrator/jobs/invoice.job.js — RESQID
// Direct invoice generation — called from completion/delivery handlers.
// =============================================================================

import { prisma } from '#config/prisma.js';
import { logger } from '#config/logger.js';

export const generateOrderInvoice = async orderId => {
  try {
    const order = await prisma.cardOrder.findUnique({
      where: { id: orderId },
      include: {
        subscription: true,
        school: true,
      },
    });

    if (!order) {
      throw new Error(`Order not found: ${orderId}`);
    }

    const invoiceType = order.payment_status === 'PARTIALLY_PAID' ? 'PARTIAL' : 'FINAL';

    // Check for existing invoice to avoid duplicates
    const existingInvoice = await prisma.invoice.findFirst({
      where: {
        order_id: orderId,
        category: 'ORDER_INVOICE',
        order_invoice_type: invoiceType,
      },
    });

    if (existingInvoice) {
      logger.info({ orderId, invoiceType }, '[invoice.job] Invoice already exists');
      return existingInvoice;
    }

    const issuedAt = new Date();
    const dueAt = new Date(issuedAt);
    dueAt.setDate(dueAt.getDate() + 7);

    const invoiceNumber = `INV-${invoiceType}-${order.order_number}-${Date.now()}`;

    const subtotal = (order.unit_price ?? 0) * order.student_count;
    const taxAmount = Math.round(subtotal * 0.18);
    const totalAmount =
      invoiceType === 'PARTIAL' ? Math.round((subtotal + taxAmount) * 0.5) : subtotal + taxAmount;

    const invoice = await prisma.invoice.create({
      data: {
        school_id: order.school_id,
        subscription_id: order.subscription_id ?? null,
        order_id: order.id,
        invoice_number: invoiceNumber,
        category: 'ORDER_INVOICE',
        order_invoice_type: invoiceType,
        student_count: order.student_count,
        unit_price: order.unit_price ?? 0,
        amount: subtotal,
        tax_amount: taxAmount,
        total_amount: totalAmount,
        status: 'ISSUED',
        issued_at: issuedAt,
        due_at: dueAt,
      },
    });

    if (invoiceType === 'PARTIAL') {
      await prisma.cardOrder.update({
        where: { id: order.id },
        data: { partial_invoice_id: invoice.id },
      });
    } else {
      await prisma.cardOrder.update({
        where: { id: order.id },
        data: { final_invoice_id: invoice.id },
      });
    }

    logger.info({ orderId, invoiceId: invoice.id, invoiceType }, '[invoice.job] Invoice generated');
    return invoice;
  } catch (err) {
    logger.error({ orderId, err: err.message }, '[invoice.job] Failed to generate invoice');
    throw err;
  }
};
