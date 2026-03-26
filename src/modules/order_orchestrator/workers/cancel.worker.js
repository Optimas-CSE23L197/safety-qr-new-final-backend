// =============================================================================
// workers/cancel.worker.js — PRODUCTION READY
// Listens for ORDER_CANCELLED events and performs cancellation cleanup:
// revokes tokens, cancels cards, voids advance invoice, notifies school.
// =============================================================================

import { Worker } from "bullmq";
import { createWorkerRedisClient } from "../../../config/redis.js";
import { logger } from "../../../config/logger.js";
import { QUEUE_NAMES } from "../orchestrator.constants.js";
import {
  claimExecution,
  markCompleted,
  releaseClaim,
} from "../services/idempotency.service.js";
import {
  beginStepExecution,
  completeStepExecution,
  failStepExecution,
} from "../services/execution.service.js";
import { stepLog, stepError } from "../utils/step.logger.js";
import {
  publishNotification,
  publishFailure,
} from "../events/event.publisher.js";
import { prisma } from "../../../config/prisma.js";

const WORKER_NAME = "cancel-worker";

async function processCancellation(orderId, stepExecutionId, jobId) {
  logger.info({ msg: "Cancellation cleanup started", orderId });

  const order = await prisma.cardOrder.findUnique({
    where: { id: orderId },
    // FIX: removed unused `items` include
    include: { tokens: true, cards: true, advanceInvoice: true },
  });

  if (!order) throw new Error(`Order ${orderId} not found`);

  await stepLog(
    stepExecutionId,
    orderId,
    "Processing order cancellation cleanup",
    {
      tokenCount: order.tokens.length,
      cardCount: order.cards.length,
      hadAdvanceInvoice: !!order.advanceInvoice,
    },
    jobId,
  );

  // Revoke all tokens
  if (order.tokens.length > 0) {
    await prisma.token.updateMany({
      where: { order_id: orderId },
      data: { status: "REVOKED", revoked_at: new Date() },
    });
    logger.info({
      msg: "Tokens revoked",
      orderId,
      count: order.tokens.length,
    });
  }

  // Mark all cards as failed
  if (order.cards.length > 0) {
    await prisma.card.updateMany({
      where: { order_id: orderId },
      data: { print_status: "FAILED" },
    });
    logger.info({
      msg: "Cards cancelled",
      orderId,
      count: order.cards.length,
    });
  }

  // Void advance invoice if present
  if (order.advance_invoice_id) {
    await prisma.invoice.update({
      where: { id: order.advance_invoice_id },
      data: { status: "CANCELLED" },
    });
    logger.info({ msg: "Advance invoice cancelled", orderId });
  }

  // Notify school
  await publishNotification("ORDER_CANCELLED", orderId, order.school_id, {
    orderNumber: order.order_number,
    cancellationReason: order.status_note || "Order cancelled",
  });

  logger.info({ msg: "Cancellation cleanup completed", orderId });

  return {
    cancelled: true,
    cancelledAt: new Date().toISOString(),
    tokensRevoked: order.tokens.length,
    cardsCancelled: order.cards.length,
  };
}

export function createCancelWorker() {
  logger.info({ msg: "Creating cancel worker" });

  const worker = new Worker(
    QUEUE_NAMES.PIPELINE,
    async (job) => {
      const { orderId, event, stepExecutionId, jobExecutionId } = job.data;

      // Only process ORDER_CANCELLED events
      if (event !== "ORDER_CANCELLED") {
        return { skipped: true, reason: `Not a cancellation event: ${event}` };
      }

      logger.info({
        msg: "Cancel worker received job",
        jobId: job.id,
        orderId,
        event,
      });

      const { claimed } = await claimExecution(orderId, "order_cancellation");
      if (!claimed) {
        logger.info({
          msg: "Cancellation already claimed, skipping",
          orderId,
        });
        return { skipped: true, reason: "Already processed" };
      }

      let stepExecution = null;

      try {
        if (!stepExecutionId) {
          // For cancellations there may be no pipeline yet (e.g. cancelled before processing)
          let pipeline = await prisma.orderPipeline.findFirst({
            where: { order_id: orderId },
          });

          if (!pipeline) {
            pipeline = await prisma.orderPipeline.create({
              data: {
                order_id: orderId,
                current_step: "CANCEL",
                overall_progress: 0,
                started_at: new Date(),
                completed_at: new Date(),
                updated_at: new Date(),
              },
            });
          }

          stepExecution = await beginStepExecution(
            pipeline.id,
            orderId,
            "CANCEL",
            "system",
          );
        } else {
          stepExecution = await prisma.orderStepExecution.findUnique({
            where: { id: stepExecutionId },
          });
        }

        if (!stepExecution)
          throw new Error(`StepExecution not found: ${stepExecutionId}`);

        const result = await processCancellation(
          orderId,
          stepExecution.id,
          jobExecutionId || job.id,
        );

        await completeStepExecution(stepExecution.id, result);
        await markCompleted(orderId, "order_cancellation", result);

        logger.info({ msg: "Cancel worker completed", jobId: job.id, orderId });
        return result;
      } catch (error) {
        logger.error({
          msg: "Cancel worker failed",
          jobId: job.id,
          orderId,
          error: error.message,
          stack: error.stack,
        });

        if (stepExecution) {
          await stepError(
            stepExecution.id,
            orderId,
            `Cancellation cleanup failed: ${error.message}`,
            {},
            jobExecutionId || job.id,
          );
          await failStepExecution(stepExecution.id, error);
        }

        await releaseClaim(orderId, "order_cancellation");
        await publishFailure(orderId, "CANCEL", error, { jobId: job.id });
        throw error;
      }
    },
    {
      connection: { client: createWorkerRedisClient("worker-cancel") },
      concurrency: 3,
      settings: {
        stalledInterval: 60000,
        maxStalledCount: 3,
        lockDuration: 120000,
      },
    },
  );

  worker.on("completed", (job) =>
    logger.info({ msg: "Cancel worker job completed", jobId: job.id }),
  );
  worker.on("failed", (job, err) =>
    logger.error({
      msg: "Cancel worker job failed",
      jobId: job?.id,
      error: err.message,
    }),
  );

  logger.info({ msg: "Cancel worker created" });
  return worker;
}