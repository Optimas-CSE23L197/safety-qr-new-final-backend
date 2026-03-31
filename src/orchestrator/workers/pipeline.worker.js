// src/orchestrator/workers/pipeline.worker.js
// Unified Pipeline Worker — replaces token.worker.js + card.worker.js
// Handles: token generation, QR codes, card numbers, card records
// Does NOT handle card design — that's design.worker.js
//
// Implements Section 3 — Worker 3: pipeline.worker.js
//
// Features:
//   - Atomic job execution with idempotency
//   - Batch processing with parallel QR generation
//   - R2 upload for QR codes
//   - Pipeline progress tracking per order
//   - Auto-pushes DESIGN jobs when order completes

import { Worker } from 'bullmq';
import { workerRedis } from '#config/redis.js';
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
import {
  generateRawToken,
  hashRawToken,
  buildScanUrl,
  batchGenerateCardNumbers,
} from '#services/token/token.helpers.js';
import { generateQrPng } from '#services/qr.service.js';
import { getStorage, StoragePath } from '#infrastructure/storage/storage.index.js';

// Constants
const TOKEN_BATCH_SIZE = 50;
const QR_PARALLEL = 10;

// =============================================================================
// Token Generation (Pipeline Step)
// Implements Section 3 — Steps 1-7
// =============================================================================

/**
 * Generate tokens for all students in an order
 */
async function generateTokens(orderId, stepExecutionId, jobId) {
  logger.info({ msg: 'Token generation started', orderId });

  // Step 1: Fetch order with items
  const order = await prisma.cardOrder.findUnique({
    where: { id: orderId },
    include: {
      school: { select: { id: true, serial_number: true, name: true, logo_url: true } },
      items: {
        where: { pipeline_status: { not: 'COMPLETE' } },
        include: { student: true },
        orderBy: { created_at: 'asc' },
      },
    },
  });

  if (!order) {
    throw new Error(`Order ${orderId} not found`);
  }

  const totalStudents = order.items.length;
  const isPreDetails = order.order_type === 'PRE_DETAILS';

  await stepLog(
    stepExecutionId,
    orderId,
    'Starting token generation',
    {
      studentCount: totalStudents,
      orderType: order.order_type,
      schoolSerial: order.school.serial_number,
    },
    jobId
  );

  // Step 2: Idempotency check — skip if all items already have card numbers
  const existingComplete = order.items.filter(
    item => item.pipeline_status === 'COMPLETE' || item.card_number
  ).length;

  if (existingComplete >= totalStudents) {
    logger.info({ msg: 'All tokens already generated, skipping', orderId });
    await stepLog(stepExecutionId, orderId, 'Skipped — all tokens already exist', {}, jobId);
    return { skipped: true, existingComplete, total: totalStudents };
  }

  // Step 3: Create token batch for tracking
  const tokenBatch = await prisma.tokenBatch.create({
    data: {
      school_id: order.school_id,
      order_id: orderId,
      count: totalStudents,
      status: 'PROCESSING',
      created_by: 'system',
    },
  });

  // Step 4: Generate card numbers (crypto-random, not sequential)
  const cardNumbers = batchGenerateCardNumbers(order.school.serial_number, totalStudents);

  let generatedCount = existingComplete;
  let failedCount = 0;

  // Step 5: Process students in batches
  for (let batchStart = 0; batchStart < totalStudents; batchStart += TOKEN_BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + TOKEN_BATCH_SIZE, totalStudents);
    const batchItems = order.items.slice(batchStart, batchEnd);
    const batchCardNumbers = cardNumbers.slice(batchStart, batchEnd);

    // Step 5.1: Generate raw tokens and prepare token data
    const rawTokens = [];
    const tokenData = [];

    for (let idx = 0; idx < batchItems.length; idx++) {
      const item = batchItems[idx];
      const rawToken = generateRawToken();
      rawTokens.push(rawToken);

      tokenData.push({
        school_id: order.school_id,
        order_id: orderId,
        batch_id: tokenBatch.id,
        token_hash: hashRawToken(rawToken),
        status: isPreDetails && item.student_id ? 'ACTIVE' : 'UNASSIGNED',
        student_id: item.student_id || null,
        order_item_id: item.id,
        assigned_at: item.student_id ? new Date() : null,
        activated_at: item.student_id ? new Date() : null,
        expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      });
    }

    // Step 5.2: Bulk insert tokens
    await prisma.token.createMany({ data: tokenData });

    // Step 5.3: Fetch back tokens with IDs (preserving order)
    const tokens = await prisma.token.findMany({
      where: { order_id: orderId, batch_id: tokenBatch.id },
      orderBy: { created_at: 'asc' },
      skip: batchStart,
      take: batchItems.length,
    });

    // Create mapping from token ID to raw token value
    const rawTokenMap = new Map();
    for (let i = 0; i < tokens.length; i++) {
      rawTokenMap.set(tokens[i].id, rawTokens[i]);
    }

    // Step 5.4-5.6: Generate QR codes, upload to R2, create cards
    const qrResults = [];

    for (let j = 0; j < tokens.length; j += QR_PARALLEL) {
      const chunk = tokens.slice(j, j + QR_PARALLEL);
      const chunkResults = await Promise.allSettled(
        chunk.map(async (token, idx) => {
          const item = batchItems[idx];
          const cardNumber = batchCardNumbers[idx];
          const rawTokenValue = rawTokenMap.get(token.id);

          // Step 5.4: Generate scan URL using token ID (AES-SIV encryption)
          const scanUrl = buildScanUrl(token.id);

          // Step 5.5: Generate QR code PNG buffer from scan URL
          const qrBuffer = await generateQrPng(scanUrl);

          // Step 5.6: Upload QR to R2 (handle null studentId for blank orders)
          const qrKeyStudentId = item.student_id || `pending-${item.id}`;
          const qrKey = StoragePath.studentQrCode(qrKeyStudentId);

          const storage = getStorage();
          const { location: qrUrl } = await storage.upload(qrBuffer, qrKey, {
            contentType: 'image/png',
            cacheControl: 'public, max-age=31536000',
          });

          return {
            token,
            item,
            rawToken: rawTokenValue,
            cardNumber,
            scanUrl,
            qrUrl,
          };
        })
      );

      for (const settled of chunkResults) {
        if (settled.status === 'fulfilled') {
          qrResults.push(settled.value);
        } else {
          logger.error({
            msg: 'QR generation failed',
            error: settled.reason?.message,
            stack: settled.reason?.stack,
          });
          failedCount++;
        }
      }

      // Update progress
      await updateStepProgress(
        stepExecutionId,
        Math.floor(((batchStart + j + chunk.length) / totalStudents) * 100),
        { processed: batchStart + j + chunk.length, total: totalStudents }
      );
    }

    // Step 5.7: Update database with generated data (transaction per batch for consistency)
    for (const result of qrResults) {
      // Update token with scan URL
      await prisma.token.update({
        where: { id: result.token.id },
        data: { scan_url: result.scanUrl },
      });

      // Create QR asset
      await prisma.qrAsset.create({
        data: {
          token_id: result.token.id,
          school_id: order.school_id,
          storage_key: `qr-codes/${order.school_id}/${result.item.student_id || result.item.id}.png`,
          public_url: result.qrUrl,
          format: 'PNG',
          width_px: 512,
          height_px: 512,
          qr_type: isPreDetails ? 'PRE_DETAILS' : 'BLANK',
          generated_by: 'system',
          order_id: orderId,
          is_active: true,
        },
      });

      // Create card record
      await prisma.card.create({
        data: {
          school_id: order.school_id,
          student_id: result.item.student_id,
          token_id: result.token.id,
          order_id: orderId,
          card_number: result.cardNumber,
          print_status: 'PENDING',
        },
      });

      // Update student with token data if student exists
      if (result.item.student_id) {
        await prisma.student.update({
          where: { id: result.item.student_id },
          data: {
            card_number: result.cardNumber,
            token: result.token.id,
            token_hash: result.token.token_hash,
            scan_url: result.scanUrl,
            qr_code_url: result.qrUrl,
            pipeline_status: 'COMPLETE',
            pipeline_completed_at: new Date(),
          },
        });
      }

      // Update order item status
      await prisma.cardOrderItem.update({
        where: { id: result.item.id },
        data: {
          pipeline_status: 'COMPLETE',
          status: 'TOKEN_GENERATED',
          card_design_url: null, // Will be set by design worker
        },
      });

      generatedCount++;
    }

    await stepLog(
      stepExecutionId,
      orderId,
      `Batch ${batchStart + 1}-${Math.min(batchEnd, totalStudents)} processed`,
      { generated: qrResults.length, failed: batchItems.length - qrResults.length },
      jobId
    );
  }

  // Step 6: Update token batch status
  const batchStatus = failedCount === 0 ? 'COMPLETE' : generatedCount > 0 ? 'PARTIAL' : 'FAILED';
  await prisma.tokenBatch.update({
    where: { id: tokenBatch.id },
    data: {
      status: batchStatus,
      generated_count: generatedCount,
      failed_count: failedCount,
      completed_at: new Date(),
      error_log: failedCount > 0 ? { failedCount, totalStudents, failedAt: new Date() } : null,
    },
  });

  // Step 7: Update order progress
  await prisma.cardOrder.update({
    where: { id: orderId },
    data: {
      pipeline_completed_count: generatedCount,
      pipeline_started_at: new Date(),
      status: generatedCount === totalStudents ? 'TOKEN_COMPLETE' : 'TOKEN_GENERATING',
    },
  });

  // If all tokens generated, prepare for design worker
  if (generatedCount === totalStudents && generatedCount > 0) {
    logger.info({
      msg: 'All tokens generated, preparing design jobs',
      orderId,
      count: generatedCount,
    });

    await prisma.cardOrder.update({
      where: { id: orderId },
      data: { status: 'TOKEN_COMPLETE' },
    });

    // Get all completed order items with their cards and tokens
    const completedItems = await prisma.cardOrderItem.findMany({
      where: { order_id: orderId, pipeline_status: 'COMPLETE' },
      include: {
        student: true,
        card: {
          where: { order_id: orderId },
          take: 1,
        },
        token: {
          include: { qrAsset: true },
        },
      },
    });

    // Push each student's design job to the DESIGN queue
    for (const item of completedItems) {
      const card = item.card?.[0];
      if (!card) {
        logger.warn({ msg: 'No card found for order item', orderId, itemId: item.id });
        continue;
      }

      // Publish event that design.worker.js listens for
      await publishEvent(EVENTS.ORDER_CARD_DESIGN_STARTED, orderId, {
        orderId,
        studentId: item.student_id,
        cardId: card.id,
        cardNumber: card.card_number,
        tokenId: item.token?.id,
        qrUrl: item.token?.qrAsset?.public_url,
        studentName: item.student_name,
        schoolId: order.school_id,
      });
    }

    // Publish completion event for notification
    await publishEvent(EVENTS.ORDER_TOKEN_GENERATION_COMPLETE, orderId, {
      orderId,
      generatedCount,
      total: totalStudents,
    });
  }

  logger.info({ msg: 'Token generation completed', orderId, generatedCount, failedCount });

  return {
    batchId: tokenBatch.id,
    generatedCount,
    failedCount,
    total: totalStudents,
    batchStatus,
  };
}

// =============================================================================
// Main Job Processor
// =============================================================================

export async function processPipelineJob(job) {
  const { orderId, stepExecutionId, jobExecutionId, event } = job.data;

  logger.info({ msg: 'Pipeline worker processing job', jobId: job.id, orderId, event });

  // Only process token generation events
  const validEvents = [EVENTS.ORDER_ADVANCE_PAYMENT_RECEIVED, EVENTS.ORDER_CONFIRMED];
  if (!validEvents.includes(event)) {
    return {
      skipped: true,
      reason: `Pipeline worker only processes token generation events, got: ${event}`,
    };
  }

  // Idempotency guard
  const { claimed } = await claimExecution(orderId, 'token_generation');
  if (!claimed) {
    logger.info({ msg: 'Token generation already claimed, skipping', orderId });
    return { skipped: true, reason: 'Already processed' };
  }

  let stepExecution = null;

  try {
    // Find or create pipeline record
    let pipeline = await prisma.orderPipeline.findFirst({
      where: { order_id: orderId },
    });

    if (!pipeline) {
      pipeline = await prisma.orderPipeline.create({
        data: {
          order_id: orderId,
          current_step: 'TOKEN_GENERATION',
          overall_progress: 0,
          started_at: new Date(),
        },
      });
    }

    stepExecution = await beginStepExecution(pipeline.id, orderId, 'TOKEN_GENERATION', 'system');

    const result = await generateTokens(orderId, stepExecution.id, jobExecutionId || job.id);

    await completeStepExecution(stepExecution.id, result);
    await markCompleted(orderId, 'token_generation', result);

    logger.info({ msg: 'Pipeline worker completed', jobId: job.id, orderId });
    return result;
  } catch (error) {
    logger.error({
      msg: 'Pipeline worker failed',
      jobId: job.id,
      orderId,
      error: error.message,
      stack: error.stack,
    });

    if (stepExecution) {
      await stepError(
        stepExecution.id,
        orderId,
        `Token generation failed: ${error.message}`,
        { error: error.message, stack: error.stack },
        jobExecutionId || job.id
      );
      await failStepExecution(stepExecution.id, error);
    }

    await releaseClaim(orderId, 'token_generation');
    await publishFailure(orderId, 'TOKEN_GENERATION', error, { jobId: job.id });
    throw error;
  }
}

// =============================================================================
// Worker Factory
// =============================================================================

export function createPipelineWorker() {
  logger.info({ msg: 'Creating pipeline worker' });

  const worker = new Worker(
    QUEUE_NAMES.JOBS_BACKGROUND,
    async job => {
      logger.info({ msg: 'Pipeline worker received job', jobId: job.id, data: job.data });
      return processPipelineJob(job);
    },
    {
      connection: workerRedis,
      concurrency: 3,
      settings: {
        stalledInterval: 60000,
        maxStalledCount: 3,
        lockDuration: 300000,
      },
    }
  );

  worker.on('completed', (job, result) => {
    logger.info({ msg: 'Pipeline worker job completed', jobId: job.id, result });
  });

  worker.on('failed', (job, err) => {
    logger.error({
      msg: 'Pipeline worker job failed',
      jobId: job?.id,
      error: err.message,
      stack: err.stack,
    });
  });

  worker.on('error', err => {
    logger.error({ msg: 'Pipeline worker error', error: err.message });
  });

  logger.info({ msg: 'Pipeline worker created', queue: QUEUE_NAMES.JOBS_BACKGROUND });
  return worker;
}

export default { createPipelineWorker };
