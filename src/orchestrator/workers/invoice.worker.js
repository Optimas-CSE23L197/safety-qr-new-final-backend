// =============================================================================
// orchestrator/workers/invoice.worker.js — RESQID PHASE 1
// Processes BACKGROUND_JOBS queue for invoice-related jobs
// =============================================================================

import { Worker } from 'bullmq';
import { getQueueConnection } from '../queues/queue.connection.js';
import { QUEUE_NAMES } from '../queues/queue.names.js';
import { handleDeadJob } from '../dlq/dlq.handler.js';
import { logger } from '#config/logger.js';
import { prisma } from '#config/prisma.js';

const QUEUE = QUEUE_NAMES.BACKGROUND_JOBS;

export async function processInvoiceJob(job) {
  const { action, orderId, invoiceId, payload } = job.data;

  logger.info({ jobId: job.id, action, orderId }, '[invoice.worker] Processing invoice job');

  switch (action) {
    case 'GENERATE_BALANCE_INVOICE':
      return generateBalanceInvoice(orderId, invoiceId);

    case 'SEND_INVOICE_NOTIFICATION':
      return sendInvoiceNotification(orderId, invoiceId, payload);

    default:
      logger.warn({ action }, '[invoice.worker] Unknown invoice action');
      return { skipped: true, reason: `Unknown action: ${action}` };
  }
}

async function generateBalanceInvoice(orderId, invoiceId) {
  logger.info({ msg: 'Generating balance invoice', orderId, invoiceId });

  // Phase 1: Simple invoice generation (expand later)
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { order: { include: { school: true } } },
  });

  if (!invoice) {
    return { error: 'Invoice not found' };
  }

  // Mark as issued
  await prisma.invoice.update({
    where: { id: invoiceId },
    data: { status: 'ISSUED', issued_at: new Date() },
  });

  logger.info({ msg: 'Balance invoice generated', invoiceId, orderId });
  return { generated: true, invoiceId, orderId };
}

async function sendInvoiceNotification(orderId, invoiceId, payload) {
  logger.info({ msg: 'Sending invoice notification', orderId, invoiceId });

  // Phase 1: Just log — actual notification goes through notification worker
  return { sent: true, invoiceId, orderId };
}

let _worker = null;

export const startInvoiceWorker = () => {
  if (_worker) return _worker;

  _worker = new Worker(QUEUE, processInvoiceJob, {
    connection: getQueueConnection(),
    concurrency: 3,
  });

  _worker.on('completed', (job, result) => {
    logger.info({ jobId: job.id, result }, '[invoice.worker] Job completed');
  });

  _worker.on('failed', async (job, error) => {
    logger.error({ jobId: job?.id, err: error.message }, '[invoice.worker] Job failed');
    if (job && job.attemptsMade >= (job.opts?.attempts ?? 3)) {
      await handleDeadJob({ job, error, queueName: QUEUE });
    }
  });

  _worker.on('error', err => {
    logger.error({ err: err.message }, '[invoice.worker] Worker error');
  });

  logger.info({ queue: QUEUE, concurrency: 3 }, '[invoice.worker] Started');
  return _worker;
};

export const stopInvoiceWorker = async () => {
  if (_worker) {
    await _worker.close();
    _worker = null;
    logger.info('[invoice.worker] Stopped');
  }
};
