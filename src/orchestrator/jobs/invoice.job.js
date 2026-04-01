// =============================================================================
// invoice.job.js — FIXED VERSION
// =============================================================================

import { prisma } from '#config/prisma.js';
import logger from '#shared/logger/logger.js';

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

    // ✅ Determine invoice type based on payment status
    const invoiceType = order.payment_status === 'PARTIALLY_PAID' ? 'PARTIAL' : 'FINAL';

    // ✅ Check for existing invoice with correct type to avoid duplicates
    const existingInvoice = await prisma.invoice.findFirst({
      where: {
        order_id: orderId,
        category: 'ORDER_INVOICE',
        order_invoice_type: invoiceType,
      },
    });

    if (existingInvoice) {
      logger.info({ orderId, invoiceType }, 'Invoice already exists');
      return existingInvoice;
    }

    // ✅ Generate collision-safe invoice number
    const issuedAt = new Date();
    const invoiceNumber = `INV-${invoiceType}-${order.order_number}-${Date.now()}`;

    // Calculate amounts
    const subtotal = (order.unit_price ?? 0) * order.student_count;
    const taxAmount = Math.round(subtotal * 0.18);
    const totalAmount =
      invoiceType === 'PARTIAL'
        ? Math.round((subtotal + taxAmount) * 0.5) // 50% advance for partial
        : subtotal + taxAmount;

    // Create invoice
    const invoice = await prisma.invoice.create({
      data: {
        school_id: order.school_id,
        subscription_id: order.subscription_id,
        order_id: order.id,
        invoice_number: invoiceNumber,
        category: 'ORDER_INVOICE',
        order_invoice_type: invoiceType,
        student_count: order.student_count,
        unit_price: order.unit_price ?? 0, // ✅ Use order's unit_price, not hardcoded 0
        amount: subtotal,
        tax_amount: taxAmount,
        total_amount: totalAmount,
        status: 'ISSUED',
        issued_at: issuedAt,
        due_at: new Date(issuedAt.setDate(issuedAt.getDate() + 7)),
      },
    });

    // ✅ Update order with invoice reference
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

    logger.info({ orderId, invoiceId: invoice.id, invoiceType }, 'Invoice generated successfully');
    return invoice;
  } catch (err) {
    logger.error({ orderId, err: err.message }, 'Failed to generate invoice');
    throw err;
  }
};
