// =============================================================================
// workers/invoice_notification.worker.js — RESQID
// Processes delayed BALANCE_INVOICE_DUE jobs.
// Fired 5 minutes after delivery confirmation — sends invoice to the school.
// =============================================================================

import { Worker } from 'bullmq';
import { createWorkerRedisClient } from '#config/redis.js';
import { logger } from '#config/logger.js';
import { prisma } from '#config/database/prisma.js';
import { publishNotification } from './events/event.publisher.js';

const INVOICE_QUEUE_NAME = 'invoice-notifications';

async function processBalanceInvoiceNotification(orderId, invoiceId) {
  logger.info({
    msg: 'Processing balance invoice notification',
    orderId,
    invoiceId,
  });

  // Fetch invoice with order + school context
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      order: {
        include: {
          school: { select: { id: true, name: true, email: true } },
        },
      },
    },
  });

  if (!invoice) {
    logger.warn({
      msg: 'Invoice not found — skipping notification',
      invoiceId,
    });
    return { skipped: true, reason: 'Invoice not found' };
  }

  if (invoice.status === 'PAID') {
    logger.info({
      msg: 'Invoice already paid — skipping notification',
      invoiceId,
    });
    return { skipped: true, reason: 'Already paid' };
  }

  if (invoice.order?.status !== 'BALANCE_PENDING') {
    logger.info({
      msg: 'Order not in BALANCE_PENDING — skipping notification',
      orderId,
      status: invoice.order?.status,
    });
    return { skipped: true, reason: `Order status: ${invoice.order?.status}` };
  }

  // Publish notification event — your notification service handles email/SMS/push
  await publishNotification('BALANCE_INVOICE_SENT', orderId, invoice.order.school_id, {
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoice_number,
    totalAmount: invoice.total_amount,
    dueAt: invoice.due_at,
    orderNumber: invoice.order.order_number,
    schoolName: invoice.order.school?.name,
  });

  logger.info({ msg: 'Balance invoice notification sent', orderId, invoiceId });

  return {
    sent: true,
    invoiceId,
    orderId,
    sentAt: new Date().toISOString(),
  };
}

export function createInvoiceNotificationWorker() {
  logger.info({ msg: 'Creating invoice notification worker' });

  const worker = new Worker(
    INVOICE_QUEUE_NAME,
    async job => {
      const { orderId, invoiceId, event } = job.data;

      if (event !== 'BALANCE_INVOICE_DUE') {
        return { skipped: true, reason: `Unknown event: ${event}` };
      }

      logger.info({
        msg: 'Invoice notification worker received job',
        jobId: job.id,
        orderId,
        invoiceId,
      });

      return processBalanceInvoiceNotification(orderId, invoiceId);
    },
    {
      connection: {
        client: createWorkerRedisClient('worker-invoice-notification'),
      },
      concurrency: 5,
      settings: {
        stalledInterval: 30_000,
        maxStalledCount: 3,
        lockDuration: 60_000,
      },
    }
  );

  worker.on('completed', (job, result) =>
    logger.info({
      msg: 'Invoice notification job completed',
      jobId: job.id,
      result,
    })
  );
  worker.on('failed', (job, err) =>
    logger.error({
      msg: 'Invoice notification job failed',
      jobId: job?.id,
      error: err.message,
    })
  );

  logger.info({ msg: 'Invoice notification worker created' });
  return worker;
}
