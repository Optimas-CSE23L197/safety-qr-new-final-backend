// src/orchestrator/workers/design.worker.js
// Design Worker — standalone entry: npm run worker:design
// =============================================================================

import 'dotenv/config';
import { Worker } from 'bullmq';
import { redis as workerRedis } from '#config/redis.js';
import { logger } from '#config/logger.js';
import { prisma } from '#config/prisma.js';
import { QUEUE_NAMES } from '../queues/queue.names.js';
import { claimExecution, markCompleted, releaseClaim } from '../services/idempotency.service.js';
import {
  beginStepExecution,
  completeStepExecution,
  failStepExecution,
  updateStepProgress,
} from '../services/execution.service.js';
import { stepLog, stepError } from '../utils/step.logger.js';
import { publishEvent, publishFailure } from '../events/event.publisher.js';
import { EVENTS } from '../events/event.types.js';
import { applyTransition } from '../state/order.guards.js';
import { ORDER_STATUS } from '../state/order.states.js';
import { generateCards } from '../services/designer.service.js';

export async function processDesignJob(job) {
  const { orderId, jobExecutionId, event, designConfig } = job.data;

  logger.info({ msg: 'Design worker received job', jobId: job.id, orderId, event });

  if (event !== 'ORDER_CARD_DESIGN_STARTED') {
    logger.info({ msg: 'Skipping non-design event', event });
    return { skipped: true, reason: `Expected ORDER_CARD_DESIGN_STARTED, got: ${event}` };
  }

  const { claimed } = await claimExecution(orderId, 'design_generation');
  if (!claimed) {
    logger.info({ msg: 'Already claimed, skipping', orderId });
    return { skipped: true, reason: 'Already processed' };
  }

  let stepExecution = null;

  try {
    let pipeline = await prisma.orderPipeline.findFirst({
      where: { order_id: orderId },
      select: { id: true },
    });

    if (!pipeline) {
      pipeline = await prisma.orderPipeline.create({
        data: {
          order_id: orderId,
          current_step: 'CARD_DESIGN',
          overall_progress: 50,
          started_at: new Date(),
        },
        select: { id: true },
      });
    }

    stepExecution = await beginStepExecution(pipeline.id, orderId, 'CARD_DESIGN', 'system');

    await stepLog(
      stepExecution.id,
      orderId,
      'Design generation started',
      {},
      jobExecutionId || job.id
    );

    const result = await generateCards({
      orderId,
      customPositions: designConfig ?? null,
      onProgress: async (percent, processed, total) => {
        await updateStepProgress(stepExecution.id, percent, { processed, total });
      },
    });

    const order = await prisma.cardOrder.findUniqueOrThrow({
      where: { id: orderId },
      select: { school_id: true, order_number: true },
    });

    await prisma.cardOrder.update({
      where: { id: orderId },
      data: {
        design_completed_count: result.generated,
        card_design_at: new Date(),
        card_design_by: 'system',
        card_design_files: {
          generated: result.generated,
          failed: result.failed,
          pdfUrl: result.pdfUrl,
          generatedAt: new Date().toISOString(),
        },
      },
    });

    // FIXED: removed 'from' parameter
    await applyTransition({
      orderId,
      to: ORDER_STATUS.CARD_DESIGN,
      actorId: 'SYSTEM',
      actorType: 'WORKER',
      schoolId: order.school_id,
      meta: { pdfUrl: result.pdfUrl, generated: result.generated, failed: result.failed },
      eventPayload: { orderNumber: order.order_number, pdfUrl: result.pdfUrl },
    });

    await publishEvent(EVENTS.ORDER_CARD_DESIGN_COMPLETE, orderId, {
      orderId,
      generatedCount: result.generated,
      failedCount: result.failed,
      pdfUrl: result.pdfUrl,
      downloadReady: true,
    });

    await completeStepExecution(stepExecution.id, result);
    await markCompleted(orderId, 'design_generation', result);

    logger.info({ msg: 'Design worker completed', jobId: job.id, orderId, ...result });
    return result;
  } catch (error) {
    logger.error({
      msg: 'Design worker failed',
      jobId: job.id,
      orderId,
      error: error.message,
      stack: error.stack,
    });

    if (stepExecution) {
      await stepError(
        stepExecution.id,
        orderId,
        `Card design failed: ${error.message}`,
        { error: error.message },
        jobExecutionId || job.id
      );
      await failStepExecution(stepExecution.id, error);
    }

    await releaseClaim(orderId, 'design_generation');
    await publishFailure(orderId, 'CARD_DESIGN', error, { jobId: job.id });
    throw error;
  }
}

export function createDesignWorker() {
  const worker = new Worker(QUEUE_NAMES.PIPELINE_JOBS, job => processDesignJob(job), {
    connection: workerRedis,
    concurrency: 1,
    stalledInterval: 90_000,
    maxStalledCount: 3,
    lockDuration: 600_000,
  });

  worker.on('completed', (job, result) => {
    logger.info({ msg: 'Design job completed', jobId: job.id, result });
  });

  worker.on('failed', (job, err) => {
    logger.error({ msg: 'Design job failed', jobId: job?.id, error: err.message });
  });

  worker.on('error', err => {
    logger.error({ msg: 'Design worker error', error: err.message });
  });

  logger.info({ msg: 'Design worker created', queue: QUEUE_NAMES.PIPELINE_JOBS });
  return worker;
}

const worker = createDesignWorker();
logger.info({ msg: '🎨 Design worker started', queue: QUEUE_NAMES.PIPELINE_JOBS });

async function shutdown(signal) {
  logger.info({ msg: `Design worker shutting down (${signal})` });
  await worker.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export default { createDesignWorker };
