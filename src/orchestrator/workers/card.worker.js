// =============================================================================
// workers/card.worker.js — PRODUCTION READY
// Listens for TOKEN_GENERATED events and generates Card records.
// Publishes CARD_GENERATED event on success to trigger design.worker downstream.
// =============================================================================

import { Worker } from 'bullmq';
import { createWorkerRedisClient } from '#config/redis.js';
import { logger } from '#config/logger.js';
import { QUEUE_NAMES } from './orchestrator.constants.js';
import { claimExecution, markCompleted, releaseClaim } from '#services/idempotency.service.js';
import {
  beginStepExecution,
  completeStepExecution,
  failStepExecution,
} from '#services/execution.service.js';
import { transitionState } from '#services/state.service.js';
import { stepLog, stepError } from '#utils/step.logger.js';
import { publishEvent, publishFailure } from './events/event.publisher.js';
import { ORDER_EVENTS } from './events/event.types.js';
import { prisma } from '#config/prisma.js';
import { batchGenerateCardNumbers } from '#services/token/token.helpers.js';

const WORKER_NAME = 'card-worker';
const BATCH_SIZE = 100;

async function generateCardRecords(orderId, stepExecutionId, jobId) {
  logger.info({ msg: 'Card generation started', orderId });

  const order = await prisma.cardOrder.findUnique({
    where: { id: orderId },
    include: {
      school: { select: { id: true, serial_number: true, name: true } },
      tokens: {
        where: { status: { in: ['UNASSIGNED', 'ACTIVE'] } },
        include: { student: true, orderItem: true },
      },
    },
  });

  if (!order) throw new Error(`Order ${orderId} not found`);

  // Idempotency: skip if cards already generated
  const existingCards = await prisma.card.count({
    where: { order_id: orderId },
  });

  if (existingCards >= order.tokens.length) {
    logger.info({
      msg: 'Cards already exist, skipping generation',
      orderId,
      existingCards,
      expected: order.tokens.length,
    });
    return { generated: 0, existing: existingCards, complete: true };
  }

  await stepLog(
    stepExecutionId,
    orderId,
    'Starting card record generation',
    {
      tokenCount: order.tokens.length,
      existingCards,
    },
    jobId
  );

  const schoolSerial = order.school.serial_number;
  const totalTokens = order.tokens.length;
  const cardNumbers = batchGenerateCardNumbers(schoolSerial, totalTokens);

  const generatedCards = [];
  const failedCards = [];

  for (let i = 0; i < totalTokens; i += BATCH_SIZE) {
    const batchTokens = order.tokens.slice(i, i + BATCH_SIZE);
    const batchNumbers = cardNumbers.slice(i, i + BATCH_SIZE);

    logger.info({
      msg: 'Processing card batch',
      orderId,
      batchStart: i,
      batchEnd: Math.min(i + BATCH_SIZE, totalTokens),
    });

    const batchResults = await Promise.allSettled(
      batchTokens.map(async (token, idx) => {
        const cardNumber = batchNumbers[idx];
        return await prisma.$transaction(async tx => {
          // Idempotency per token
          const existingCard = await tx.card.findFirst({
            where: { token_id: token.id },
          });
          if (existingCard) return existingCard;

          return await tx.card.create({
            data: {
              school_id: order.school_id,
              student_id: token.student_id,
              token_id: token.id,
              order_id: orderId,
              card_number: cardNumber,
              file_url: null,
              print_status: 'PENDING',
            },
          });
        });
      })
    );

    for (const settled of batchResults) {
      if (settled.status === 'fulfilled') {
        generatedCards.push(settled.value);
      } else {
        logger.error({
          msg: 'Card creation failed for token in batch',
          orderId,
          error: settled.reason?.message,
        });
        failedCards.push({ error: settled.reason?.message });
      }
    }
  }

  logger.info({
    msg: 'Card generation completed',
    orderId,
    generated: generatedCards.length,
    failed: failedCards.length,
    total: totalTokens,
  });

  return {
    generated: generatedCards.length,
    failed: failedCards.length,
    total: totalTokens,
    // Only return a sample to avoid bloating job result payload
    sampleCards: generatedCards.slice(0, 5).map(c => ({
      id: c.id,
      cardNumber: c.card_number,
    })),
  };
}

async function processCardGeneration(orderId, stepExecutionId, jobId) {
  const result = await generateCardRecords(orderId, stepExecutionId, jobId);

  await transitionState(orderId, 'CARD_GENERATED', 'system', {
    generated: result.generated,
    failed: result.failed,
  });

  // Publish CARD_GENERATED → triggers design.worker
  await publishEvent(ORDER_EVENTS.CARD_GENERATED, orderId, result);

  return result;
}

export function createCardWorker() {
  logger.info({ msg: 'Creating card worker' });

  const worker = new Worker(
    QUEUE_NAMES.PIPELINE,
    async job => {
      const { orderId, event, stepExecutionId, jobExecutionId } = job.data;

      // Only process TOKEN_GENERATED events
      if (event !== 'TOKEN_GENERATED') {
        return {
          skipped: true,
          reason: `Not a token generated event: ${event}`,
        };
      }

      logger.info({
        msg: 'Card worker received job',
        jobId: job.id,
        orderId,
        event,
      });

      const { claimed } = await claimExecution(orderId, 'card_generation');
      if (!claimed) {
        logger.info({
          msg: 'Card generation already claimed, skipping',
          orderId,
        });
        return { skipped: true, reason: 'Already processed' };
      }

      let stepExecution = null;

      try {
        if (!stepExecutionId) {
          const pipeline = await prisma.orderPipeline.findFirst({
            where: { order_id: orderId },
          });
          if (!pipeline) throw new Error(`Pipeline not found for order ${orderId}`);
          // FIX: correct step name is "CARD", not 'CARD_DESIGN'
          stepExecution = await beginStepExecution(pipeline.id, orderId, 'CARD', 'system');
        } else {
          stepExecution = await prisma.orderStepExecution.findUnique({
            where: { id: stepExecutionId },
          });
        }

        if (!stepExecution) throw new Error(`StepExecution not found: ${stepExecutionId}`);

        const result = await processCardGeneration(
          orderId,
          stepExecution.id,
          jobExecutionId || job.id
        );

        await completeStepExecution(stepExecution.id, result);
        await markCompleted(orderId, 'card_generation', result);

        logger.info({ msg: 'Card worker completed', jobId: job.id, orderId });
        return result;
      } catch (error) {
        logger.error({
          msg: 'Card worker failed',
          jobId: job.id,
          orderId,
          error: error.message,
          stack: error.stack,
        });

        if (stepExecution) {
          await stepError(
            stepExecution.id,
            orderId,
            `Card generation failed: ${error.message}`,
            {},
            jobExecutionId || job.id
          );
          await failStepExecution(stepExecution.id, error);
        }

        await releaseClaim(orderId, 'card_generation');
        await publishFailure(orderId, 'CARD', error, { jobId: job.id });
        throw error;
      }
    },
    {
      connection: { client: createWorkerRedisClient('worker-card') },
      concurrency: 3,
      settings: {
        stalledInterval: 60000,
        maxStalledCount: 3,
        lockDuration: 120000,
      },
    }
  );

  worker.on('completed', job => logger.info({ msg: 'Card worker job completed', jobId: job.id }));
  worker.on('failed', (job, err) =>
    logger.error({
      msg: 'Card worker job failed',
      jobId: job?.id,
      error: err.message,
    })
  );

  logger.info({ msg: 'Card worker created' });
  return worker;
}
