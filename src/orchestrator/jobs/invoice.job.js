// =============================================================================
// orchestrator/jobs/invoice.job.js — RESQID PHASE 1
// Balance invoice generation — triggered after ORDER_DELIVERED
// =============================================================================

import { prisma } from '#config/prisma.js';
import { logger } from '#config/logger.js';
import { backgroundJobsQueue } from '../queues/queue.config.js';

export const handleInvoiceGeneration = async (job, dbJob = null) => {
  const { orderId, schoolId, orderNumber, balanceAmount, action } = job.data ?? {};

  if (!orderId) throw new Error('[invoice.job] orderId is required');

  logger.info({ jobId: job.id, orderId, action }, '[invoice.job] Generating invoice');

  const order = await prisma.cardOrder.findUnique({
    where: { id: orderId },
    include: { school: { select: { id: true, name: true, email: true } } },
  });

  if (!order) throw new Error(`[invoice.job] Order not found: ${orderId}`);

  // Check if invoice already exists
  const existingInvoice = await prisma.invoice.findFirst({
    where: { order_id: orderId, category: 'ORDER_INVOICE' },
  });

  if (existingInvoice) {
    logger.info(
      { orderId, invoiceId: existingInvoice.id },
      '[invoice.job] Invoice exists — skipping'
    );
    return { success: true, data: { skipped: true, invoiceId: existingInvoice.id } };
  }

  const issuedAt = new Date();
  const dueAt = new Date(issuedAt.getTime() + 7 * 24 * 60 * 60 * 1000);
  const invoiceNumber = `INV-${order.order_number}-${issuedAt.getFullYear()}`;
  const amount = balanceAmount ?? order.balance_amount ?? 0;

  // Create invoice record (PDF generation simplified for Phase 1)
  const invoice = await prisma.invoice.create({
    data: {
      order_id: orderId,
      school_id: order.school_id,
      invoice_number: invoiceNumber,
      category: 'ORDER_INVOICE',
      order_invoice_type: order.payment_status === 'PARTIALLY_PAID' ? 'PARTIAL' : 'FINAL',
      student_count: order.student_count,
      unit_price: 0,
      amount: amount,
      tax_amount: 0,
      total_amount: amount,
      status: 'ISSUED',
      issued_at: issuedAt,
      due_at: dueAt,
    },
  });

  // Update order with invoice reference
  if (order.payment_status === 'PARTIALLY_PAID') {
    await prisma.cardOrder.update({
      where: { id: orderId },
      data: { partial_invoice_id: invoice.id },
    });
  } else {
    await prisma.cardOrder.update({
      where: { id: orderId },
      data: { final_invoice_id: invoice.id },
    });
  }

  logger.info({ orderId, invoiceId: invoice.id, invoiceNumber }, '[invoice.job] Invoice created');

  // Enqueue notification job
  await backgroundJobsQueue.add(
    'SEND_INVOICE_NOTIFICATION',
    {
      action: 'SEND_INVOICE_NOTIFICATION',
      orderId,
      invoiceId: invoice.id,
      payload: { invoiceNumber, amount, dueAt },
    },
    { jobId: `invoice-notify-${orderId}` }
  );

  return { success: true, data: { orderId, invoiceId: invoice.id, invoiceNumber } };
};
