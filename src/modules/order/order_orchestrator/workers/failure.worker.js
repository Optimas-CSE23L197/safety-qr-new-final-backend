// =============================================================================
// workers/failure.worker.js — PRODUCTION READY
// Listens for STEP_FAILED events. Handles escalation, pipeline stalling,
// and order status updates for critical step failures.
//
// NOTE: job.data.error is a plain serialised object (JSON), NOT an Error
// instance. We normalise it to { message, attempts, stack } with safe
// defaults before using it anywhere.
// =============================================================================

import { Worker } from 'bullmq';
import { redis, createWorkerRedisClient } from '#config/redis.js';
import { logger } from '#config/logger.js';
import { QUEUE_NAMES, REDIS_KEYS } from './orchestrator.constants.js';
import { claimExecution, markCompleted, releaseClaim } from '#services/idempotency.service.js';
import {
  beginStepExecution,
  completeStepExecution,
  failStepExecution,
} from '#services/execution.service.js';
import { stepLog, stepError } from '#utils/step.logger.js';
import { publishNotification } from './events/event.publisher.js';
import { shouldEscalateOnDLQ } from './policies/retry.policy.js';
import { prisma } from '#config/database/prisma.js';

const WORKER_NAME = 'failure-worker';

/**
 * Steps whose failure is critical enough to cancel the entire order.
 */
const CRITICAL_STEPS = new Set(['TOKEN_GENERATION', 'CARD_DESIGN', 'PAYMENT']);

/**
 * Normalise the raw error payload coming off job.data.error.
 * BullMQ serialises Error objects to plain JSON — reconstruct a safe shape.
 */
function normaliseError(raw) {
  if (!raw) return { message: 'Unknown error', attempts: 0, stack: null };
  if (typeof raw === 'string') return { message: raw, attempts: 0, stack: null };
  return {
    message: raw.message || 'Unknown error',
    attempts: typeof raw.attempts === 'number' ? raw.attempts : 0,
    stack: raw.stack || null,
  };
}

async function handleStepFailure(orderId, step, rawError, stepExecutionId, jobId) {
  // FIX: normalise the serialised error object before use
  const error = normaliseError(rawError);

  logger.warn({
    msg: 'Handling step failure',
    orderId,
    step,
    errorMessage: error.message,
    attempts: error.attempts,
  });

  const order = await prisma.cardOrder.findUnique({
    where: { id: orderId },
    select: { id: true, school_id: true, order_number: true, status: true },
  });

  if (!order) {
    logger.warn({ msg: 'Order not found in failure handler', orderId });
    return { handled: false, reason: 'Order not found' };
  }

  await stepLog(
    stepExecutionId,
    orderId,
    `Handling failure for step: ${step}`,
    { errorMessage: error.message, attempts: error.attempts },
    jobId
  );

  // Check DLQ retry count for escalation threshold
  const retryKey = REDIS_KEYS.DLQ_COUNT(orderId);
  const retryCount = parseInt((await redis.get(retryKey)) || '0', 10);
  const shouldEscalate = shouldEscalateOnDLQ(step) && retryCount >= 2;

  if (shouldEscalate) {
    logger.warn({
      msg: 'Escalating failure to super admins',
      orderId,
      step,
      retryCount,
    });

    const superAdmins = await prisma.superAdmin.findMany({
      where: { is_active: true },
      select: { id: true, email: true },
    });

    // Notify each super admin — fire-and-forget failures here are acceptable
    await Promise.allSettled(
      superAdmins.map(admin =>
        publishNotification('STEP_FAILURE_ESCALATED', orderId, admin.id, {
          orderNumber: order.order_number,
          step,
          errorMessage: error.message,
          retryCount,
          schoolId: order.school_id,
        })
      )
    );
  }

  // Mark pipeline as stalled
  const pipeline = await prisma.orderPipeline.findFirst({
    where: { order_id: orderId },
  });

  if (pipeline && !pipeline.is_stalled) {
    await prisma.orderPipeline.update({
      where: { id: pipeline.id },
      data: {
        is_stalled: true,
        stalled_at: new Date(),
        stalled_reason: `Step ${step} failed: ${error.message}`,
      },
    });
  }

  // Cancel order for critical step failures (only if not already cancelled)
  if (CRITICAL_STEPS.has(step) && order.status !== 'CANCELLED') {
    await prisma.cardOrder.update({
      where: { id: orderId },
      data: {
        status: 'CANCELLED',
        status_note: `Failed at step ${step}: ${error.message}`,
        status_changed_at: new Date(),
      },
    });
    logger.warn({
      msg: 'Order cancelled due to critical step failure',
      orderId,
      step,
    });
  }

  return {
    handled: true,
    step,
    escalated: shouldEscalate,
    retryCount,
    stalled: true,
  };
}

export function createFailureWorker() {
  logger.info({ msg: 'Creating failure worker' });

  const worker = new Worker(
    QUEUE_NAMES.PIPELINE,
    async job => {
      const { orderId, step, error: rawError, stepExecutionId, jobExecutionId } = job.data;
      const event = job.data.event;

      // Only process STEP_FAILED events
      if (event !== 'STEP_FAILED') {
        return { skipped: true, reason: `Not a step failed event: ${event}` };
      }

      logger.warn({
        msg: 'Failure worker received job',
        jobId: job.id,
        orderId,
        step,
      });

      const { claimed } = await claimExecution(orderId, `failure_${step}`);
      if (!claimed) {
        logger.info({
          msg: 'Failure handling already claimed, skipping',
          orderId,
          step,
        });
        return { skipped: true, reason: 'Already processed' };
      }

      let stepExecution = null;

      try {
        if (!stepExecutionId) {
          const pipeline = await prisma.orderPipeline.findFirst({
            where: { order_id: orderId },
          });
          if (pipeline) {
            stepExecution = await beginStepExecution(pipeline.id, orderId, 'FAILURE', 'system');
          }
        } else {
          stepExecution = await prisma.orderStepExecution.findUnique({
            where: { id: stepExecutionId },
          });
        }

        const result = await handleStepFailure(
          orderId,
          step,
          rawError,
          stepExecution?.id || stepExecutionId,
          jobExecutionId || job.id
        );

        if (stepExecution) await completeStepExecution(stepExecution.id, result);
        await markCompleted(orderId, `failure_${step}`, result);

        logger.info({
          msg: 'Failure worker completed',
          jobId: job.id,
          orderId,
          step,
        });
        return result;
      } catch (err) {
        logger.error({
          msg: 'Failure worker itself failed',
          jobId: job.id,
          orderId,
          step,
          error: err.message,
          stack: err.stack,
        });

        if (stepExecution) {
          await stepError(
            stepExecution.id,
            orderId,
            `Failure handler failed: ${err.message}`,
            { originalError: normaliseError(rawError).message },
            jobExecutionId || job.id
          );
          await failStepExecution(stepExecution.id, err);
        }

        await releaseClaim(orderId, `failure_${step}`);
        throw err;
      }
    },
    {
      connection: { client: createWorkerRedisClient('worker-failure') },
      concurrency: 3,
      settings: {
        stalledInterval: 60000,
        maxStalledCount: 3,
        lockDuration: 120000,
      },
    }
  );

  worker.on('completed', job =>
    logger.info({ msg: 'Failure worker job completed', jobId: job.id })
  );
  worker.on('failed', (job, err) =>
    logger.error({
      msg: 'Failure worker job failed',
      jobId: job?.id,
      error: err.message,
    })
  );

  logger.info({ msg: 'Failure worker created' });
  return worker;
}
