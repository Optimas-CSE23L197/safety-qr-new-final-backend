// =============================================================================
// jobs/invoice.job.js — RESQID
// BullMQ delayed job: sends the balance invoice notification 5 minutes
// after delivery is confirmed. Keeps the controller clean — just call
// scheduleBalanceInvoiceNotification() and forget about it.
// =============================================================================

import { Queue } from "bullmq";
import { createWorkerRedisClient } from "../../config/redis.js";
import { logger } from "../../config/logger.js";

const INVOICE_QUEUE_NAME = "invoice-notifications";

// Lazily initialised — created on first use, reused after that.
let _invoiceQueue = null;

const getInvoiceQueue = () => {
  if (!_invoiceQueue) {
    _invoiceQueue = new Queue(INVOICE_QUEUE_NAME, {
      connection: { client: createWorkerRedisClient("queue-invoice") },
      defaultJobOptions: {
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 },
        attempts: 3,
        backoff: { type: "exponential", delay: 60_000 },
      },
    });
  }
  return _invoiceQueue;
};

// =============================================================================
// SCHEDULE — BALANCE INVOICE NOTIFICATION
// Call this right after confirmDelivery succeeds.
// delayMs defaults to 5 minutes.
// =============================================================================

export const scheduleBalanceInvoiceNotification = async ({
  orderId,
  invoiceId,
  delayMs = 5 * 60 * 1000,
}) => {
  const queue = getInvoiceQueue();

  const job = await queue.add(
    "send-balance-invoice",
    { orderId, invoiceId, event: "BALANCE_INVOICE_DUE" },
    {
      delay: delayMs,
      jobId: `balance-invoice-${orderId}`, // deduplication key
    },
  );

  logger.info({
    msg: "Balance invoice notification scheduled",
    orderId,
    invoiceId,
    jobId: job.id,
    delayMs,
    sendAt: new Date(Date.now() + delayMs).toISOString(),
  });

  return job;
};

// =============================================================================
// CLOSE QUEUE (call on graceful shutdown)
// =============================================================================

export const closeInvoiceQueue = async () => {
  if (_invoiceQueue) {
    await _invoiceQueue.close();
    _invoiceQueue = null;
  }
};
