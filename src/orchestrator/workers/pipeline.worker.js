// src/orchestrator/workers/pipeline.worker.js
// Unified Pipeline Worker — Handles token generation for BLANK and PRE_DETAILS orders
// =============================================================================

console.log('========================================');
console.log('Pipeline Worker Module Loading...');
console.log('========================================');

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
import {
  initializeStorage,
  getStorage,
  StoragePath,
} from '#infrastructure/storage/storage.index.js';
import { applyTransition } from '../state/order.guards.js';
import { ORDER_STATUS } from '../state/order.states.js';

console.log('All imports loaded successfully');
console.log('Queue Names:', QUEUE_NAMES);
console.log('========================================\n');

// Constants
const TOKEN_BATCH_SIZE = 50;
const QR_PARALLEL = 10;

// =============================================================================
// Maintenance Job Handlers
// =============================================================================

async function handleExpireIpBlocklist(job) {
  logger.info({ msg: 'Running IP blocklist expiration scan', jobId: job.id });

  try {
    const expiredCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const deleted = await prisma.ipBlocklist.deleteMany({
      where: { expires_at: { lt: expiredCutoff } },
    });

    logger.info({ msg: 'IP blocklist expiration scan completed', deletedCount: deleted.count });
    return { success: true, deletedCount: deleted.count, cutoff: expiredCutoff };
  } catch (error) {
    logger.error({ msg: 'IP blocklist expiration scan failed', error: error.message });
    throw error;
  }
}

async function handleSyncIpBlocklist(job) {
  logger.info({ msg: 'Running IP blocklist sync', jobId: job.id });

  try {
    const activeBlocks = await prisma.ipBlocklist.count({
      where: { expires_at: { gt: new Date() } },
    });

    logger.info({ msg: 'IP blocklist sync completed', activeCount: activeBlocks });
    return { success: true, activeCount: activeBlocks, syncedAt: new Date() };
  } catch (error) {
    logger.error({ msg: 'IP blocklist sync failed', error: error.message });
    throw error;
  }
}

// =============================================================================
// Token Generation (Pipeline Step)
// =============================================================================

async function generateTokens(orderId, stepExecutionId, jobId) {
  console.log(`\n🔵 Token generation started for order: ${orderId}`);
  logger.info({ msg: 'Token generation started', orderId });

  try {
    // STEP 1: Fetch order meta to determine type
    const orderMeta = await prisma.cardOrder.findUnique({
      where: { id: orderId },
      select: { order_type: true },
    });

    if (!orderMeta) throw new Error(`Order ${orderId} not found`);
    console.log(`✅ Order type: ${orderMeta.order_type}`);

    const isBlank = orderMeta.order_type === 'BLANK';
    const isPreDetails = orderMeta.order_type === 'PRE_DETAILS';

    // STEP 2: Fetch full order with items
    const order = await prisma.cardOrder.findUnique({
      where: { id: orderId },
      include: {
        school: { select: { id: true, serial_number: true, name: true, logo_url: true } },
        items: isBlank
          ? false
          : {
              where: { pipeline_status: { not: 'COMPLETE' } },
              include: { student: true },
              orderBy: { created_at: 'asc' },
            },
      },
    });

    if (!order) throw new Error(`Order ${orderId} not found`);

    const totalStudents = isBlank ? (order.student_count ?? 0) : (order.items?.length ?? 0);
    console.log(`✅ Total students to process: ${totalStudents}`);

    if (totalStudents === 0) {
      console.log(`⚠️ No students to process for order: ${orderId}`);
      return { skipped: true, reason: 'No students', total: 0 };
    }

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

    // STEP 3: Idempotency check
    const existingComplete = isBlank
      ? await prisma.card.count({ where: { order_id: orderId } })
      : (order.items ?? []).filter(item => item.pipeline_status === 'COMPLETE' || item.card_number)
          .length;

    const existingTokens = await prisma.token.count({ where: { order_id: orderId } });
    if (existingTokens > 0) {
      console.log(`⚠️ Found ${existingTokens} existing tokens, cleaning up partial run...`);
      await prisma.token.deleteMany({ where: { order_id: orderId } });
      await prisma.card.deleteMany({ where: { order_id: orderId } });
      await prisma.qrAsset.deleteMany({ where: { order_id: orderId } });
    }

    console.log(`✅ Existing complete: ${existingComplete}`);

    if (existingComplete >= totalStudents) {
      console.log(`✅ All tokens already generated, skipping order: ${orderId}`);
      await stepLog(stepExecutionId, orderId, 'Skipped — all tokens already exist', {}, jobId);
      return { skipped: true, existingComplete, total: totalStudents };
    }

    // STEP 4: Create token batch
    const tokenBatch = await prisma.tokenBatch.create({
      data: {
        school_id: order.school_id,
        order_id: orderId,
        count: totalStudents,
        status: 'PROCESSING',
        created_by: 'system',
      },
    });
    console.log(`✅ Token batch created: ${tokenBatch.id}`);

    // STEP 5: Generate card numbers
    const cardNumbers = batchGenerateCardNumbers(order.school.serial_number, totalStudents);
    console.log(`✅ Generated ${cardNumbers.length} card numbers`);

    let generatedCount = existingComplete;
    let failedCount = 0;

    // Build process items array
    const processItems = isBlank
      ? Array.from({ length: totalStudents }, (_, idx) => ({
          id: `blank-${idx}`,
          student_id: null,
          student_name: null,
          class: null,
          section: null,
        }))
      : (order.items ?? []);

    // STEP 6: Initialize storage once before batch processing
    let storage;
    try {
      storage = getStorage();
      console.log(`✅ Storage already initialized`);
    } catch (e) {
      console.log(`🔵 Initializing storage...`);
      await initializeStorage({
        ENDPOINT: process.env.AWS_S3_ENDPOINT,
        BUCKET: process.env.AWS_S3_BUCKET,
        ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
        SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
        CDN_DOMAIN: process.env.AWS_CDN_DOMAIN,
      });
      storage = getStorage();
      console.log(`✅ Storage initialized`);
    }

    // STEP 7: Process in batches
    console.log(`🔵 Starting batch processing with batch size: ${TOKEN_BATCH_SIZE}`);
    for (let batchStart = 0; batchStart < totalStudents; batchStart += TOKEN_BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + TOKEN_BATCH_SIZE, totalStudents);
      console.log(
        `\n📦 Processing batch ${batchStart + 1} to ${batchEnd} (${batchEnd - batchStart} items)`
      );

      const batchItems = processItems.slice(batchStart, batchEnd);
      const batchCardNumbers = cardNumbers.slice(batchStart, batchEnd);

      // Generate raw tokens
      console.log(`  🔵 Generating raw tokens for batch...`);
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
          order_item_id: isBlank ? null : item.id,
          assigned_at: item.student_id ? new Date() : null,
          activated_at: item.student_id ? new Date() : null,
          expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        });
      }
      console.log(`  ✅ Generated ${tokenData.length} token records`);

      // Bulk insert tokens
      console.log(`  🔵 Inserting tokens into database...`);
      await prisma.token.createMany({ data: tokenData });
      console.log(`  ✅ Tokens inserted`);

      // Fetch created tokens
      console.log(`  🔵 Fetching created tokens...`);
      const tokens = await prisma.token.findMany({
        where: { order_id: orderId, batch_id: tokenBatch.id },
        orderBy: { created_at: 'asc' },
        skip: batchStart,
        take: batchItems.length,
      });
      console.log(`  ✅ Fetched ${tokens.length} tokens`);

      // Persist raw tokens to Redis for recovery
      const rawTokenMap = new Map();
      for (let i = 0; i < tokens.length; i++) {
        rawTokenMap.set(tokens[i].id, rawTokens[i]);
      }

      const recoveryKey = `pipeline:recovery:${orderId}:${tokenBatch.id}:${batchStart}`;
      await workerRedis.setex(recoveryKey, 3600, JSON.stringify(Array.from(rawTokenMap.entries())));
      console.log(`  ✅ Recovery key saved: ${recoveryKey}`);

      // Generate QR codes
      console.log(`  🔵 Generating QR codes...`);
      const qrResults = [];

      for (let j = 0; j < tokens.length; j += QR_PARALLEL) {
        const chunk = tokens.slice(j, j + QR_PARALLEL);
        console.log(
          `    📸 Processing QR chunk ${Math.floor(j / QR_PARALLEL) + 1}/${Math.ceil(tokens.length / QR_PARALLEL)}`
        );

        const chunkResults = await Promise.allSettled(
          chunk.map(async (token, idx) => {
            try {
              const item = batchItems[j + idx];
              const cardNumber = batchCardNumbers[j + idx];
              const rawTokenValue = rawTokenMap.get(token.id);

              const scanUrl = buildScanUrl(token.id);
              const qrBuffer = await generateQrPng(scanUrl);

              const qrKeyStudentId = item.student_id || `pending-${token.id}`;
              const qrKey = StoragePath.studentQrCode(qrKeyStudentId);

              const { location: qrUrl } = await storage.upload(qrBuffer, qrKey, {
                contentType: 'image/png',
                cacheControl: 'public, max-age=31536000',
              });

              return { token, item, rawToken: rawTokenValue, cardNumber, scanUrl, qrUrl };
            } catch (err) {
              console.log(`    🔴 QR generation failed for token ${token.id}: ${err.message}`);
              throw err;
            }
          })
        );

        for (const settled of chunkResults) {
          if (settled.status === 'fulfilled') {
            qrResults.push(settled.value);
          } else {
            console.log(`    🔴 QR generation failed: ${settled.reason?.message}`);
            logger.error({
              msg: 'QR generation failed',
              error: settled.reason?.message,
            });
            failedCount++;
          }
        }

        await updateStepProgress(
          stepExecutionId,
          Math.floor(((batchStart + j + chunk.length) / totalStudents) * 100),
          { processed: batchStart + j + chunk.length, total: totalStudents }
        );
      }
      console.log(
        `  ✅ QR generation complete. Successful: ${qrResults.length}, Failed: ${batchItems.length - qrResults.length}`
      );

      // Transaction for successful QR results
      if (qrResults.length > 0) {
        console.log(`  🔵 Committing ${qrResults.length} records to database...`);
        await prisma.$transaction(async tx => {
          for (const result of qrResults) {
            await tx.qrAsset.create({
              data: {
                token_id: result.token.id,
                school_id: order.school_id,
                storage_key: `qr-codes/${order.school_id}/${result.item.student_id || result.token.id}.png`,
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

            await tx.card.create({
              data: {
                school_id: order.school_id,
                student_id: result.item.student_id,
                token_id: result.token.id,
                order_id: orderId,
                card_number: result.cardNumber,
                print_status: 'PENDING',
              },
            });

            if (result.item.student_id) {
              await tx.student.update({
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

            if (!isBlank) {
              await tx.cardOrderItem.update({
                where: { id: result.item.id },
                data: {
                  pipeline_status: 'COMPLETE',
                  status: 'TOKEN_GENERATED',
                  card_design_url: null,
                },
              });
            }
          }
        });
        console.log(`  ✅ Transaction committed`);

        generatedCount += qrResults.length;
      }

      // Clean up recovery key
      await workerRedis.del(recoveryKey);
      console.log(`  ✅ Recovery key deleted`);

      await stepLog(
        stepExecutionId,
        orderId,
        `Batch ${batchStart + 1}-${Math.min(batchEnd, totalStudents)} processed`,
        { generated: qrResults.length, failed: batchItems.length - qrResults.length },
        jobId
      );
    }

    // STEP 8: Update token batch status
    console.log(`\n🔵 Updating token batch status`);
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
    console.log(
      `✅ Batch status: ${batchStatus}, Generated: ${generatedCount}, Failed: ${failedCount}`
    );

    // STEP 9: Update order status based on success
    console.log(`\n🔵 Updating order status`);
    if (generatedCount === totalStudents && generatedCount > 0) {
      console.log(`✅ All tokens generated successfully (${generatedCount}/${totalStudents})`);

      await prisma.cardOrder.update({
        where: { id: orderId },
        data: {
          pipeline_completed_count: generatedCount,
          pipeline_started_at: new Date(),
          tokens_generated_at: new Date(),
          status: 'TOKEN_GENERATED',
        },
      });
      console.log(`✅ Order status updated to TOKEN_GENERATED`);

      // Apply state transition only if status changed
      if (order.status !== ORDER_STATUS.TOKEN_GENERATED) {
        console.log(`🔵 Applying state transition from ${order.status} to TOKEN_GENERATED`);
        await applyTransition({
          orderId,
          from: order.status,
          to: ORDER_STATUS.TOKEN_GENERATED,
          actorId: 'SYSTEM',
          actorType: 'WORKER',
          schoolId: order.school_id,
          meta: { generated: generatedCount, failed: failedCount },
          eventPayload: { orderNumber: order.order_number, tokenCount: generatedCount },
        });
        console.log(`✅ State transition applied`);
      }

      // Publish events
      console.log(`🔵 Publishing token generation complete event`);
      await publishEvent(EVENTS.ORDER_TOKEN_GENERATION_COMPLETE, orderId, {
        orderId,
        generatedCount,
        total: totalStudents,
      });

      // For PRE_DETAILS orders, trigger design for each student
      if (!isBlank) {
        console.log(`🔵 Publishing design events for ${totalStudents} students`);
        const completedItems = await prisma.cardOrderItem.findMany({
          where: { order_id: orderId, pipeline_status: 'COMPLETE' },
          include: {
            student: true,
            card: { where: { order_id: orderId }, take: 1 },
            token: { include: { qrAsset: true } },
          },
        });

        for (const item of completedItems) {
          const card = item.card?.[0];
          if (!card) continue;

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
        console.log(`✅ Design events published`);
      }
    } else if (generatedCount > 0 && generatedCount < totalStudents) {
      console.log(`⚠️ Partial success: ${generatedCount}/${totalStudents} tokens generated`);
      await prisma.cardOrder.update({
        where: { id: orderId },
        data: {
          pipeline_completed_count: generatedCount,
          pipeline_started_at: new Date(),
        },
      });
      logger.warn({
        msg: 'Partial token generation',
        orderId,
        generated: generatedCount,
        failed: failedCount,
      });
    } else {
      console.log(`🔴 Complete failure: 0/${totalStudents} tokens generated`);
      logger.error({ msg: 'Token generation completely failed', orderId, failedCount });
      throw new Error(`Token generation failed for order ${orderId}`);
    }

    console.log(`\n✅ Token generation completed for order ${orderId}`);
    logger.info({ msg: 'Token generation completed', orderId, generatedCount, failedCount });

    return {
      batchId: tokenBatch.id,
      generatedCount,
      failedCount,
      total: totalStudents,
      batchStatus,
    };
  } catch (error) {
    console.log(
      `\n🔴 [CRITICAL ERROR] Token generation failed for order ${orderId}:`,
      error.message
    );
    console.log(error.stack);
    throw error;
  }
}

// =============================================================================
// Main Job Processor
// =============================================================================

export async function processPipelineJob(job) {
  console.log(`\n🔥 PROCESSING JOB: ${job.id}, Name: ${job.name}`);
  const jobName = job.name;
  const { orderId, stepExecutionId, jobExecutionId, event } = job.data;

  logger.info({
    msg: 'Pipeline worker processing job',
    jobId: job.id,
    jobName,
    event,
    orderId,
  });

  // Maintenance jobs
  if (jobName === 'scan:expire_ip_blocklist') {
    return handleExpireIpBlocklist(job);
  }

  if (jobName === 'scan:sync_ip_blocklist') {
    return handleSyncIpBlocklist(job);
  }

  const validEvents = [EVENTS.ORDER_ADVANCE_PAYMENT_RECEIVED, EVENTS.ORDER_CONFIRMED];

  if (!orderId) {
    console.log(`⚠️ Job missing orderId, skipping`);
    logger.warn({ msg: 'Job missing orderId, skipping', jobId: job.id });
    return { skipped: true, reason: 'Missing orderId' };
  }

  if (!validEvents.includes(event)) {
    console.log(`⚠️ Skipping job — event not handled by pipeline worker: ${event}`);
    logger.info({
      msg: 'Skipping job — event not handled by pipeline worker',
      jobId: job.id,
      event,
    });
    return {
      skipped: true,
      reason: `Pipeline worker only processes token generation events, got: ${event}`,
    };
  }

  // Idempotency guard
  const { claimed } = await claimExecution(orderId, 'token_generation');
  if (!claimed) {
    console.log(`⚠️ Token generation already claimed, skipping order: ${orderId}`);
    logger.info({ msg: 'Token generation already claimed, skipping', orderId });
    return { skipped: true, reason: 'Already processed' };
  }

  let stepExecution = null;

  try {
    let pipeline = await prisma.orderPipeline.findFirst({ where: { order_id: orderId } });

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

    console.log(`✅ Pipeline worker completed for order: ${orderId}`);
    logger.info({ msg: 'Pipeline worker completed', jobId: job.id, orderId });
    return result;
  } catch (error) {
    console.log(`🔴 Pipeline worker failed for order ${orderId}:`, error.message);
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
    QUEUE_NAMES.PIPELINE_JOBS,
    async job => {
      console.log(`🔥 Pipeline worker received job: ${job.id}, ${job.name}`);
      logger.info({
        msg: 'Pipeline worker received job',
        jobId: job.id,
        jobName: job.name,
        data: job.data,
      });

      try {
        return await processPipelineJob(job);
      } catch (error) {
        console.log(`🔴 Pipeline worker job error: ${error.message}`);
        logger.error({
          msg: 'Pipeline worker job error',
          jobId: job.id,
          jobName: job.name,
          error: error.message,
          stack: error.stack,
        });
        throw error;
      }
    },
    {
      connection: workerRedis,
      concurrency: 3,
      stalledInterval: 60000,
      maxStalledCount: 3,
      lockDuration: 300000,
    }
  );

  worker.on('completed', (job, result) => {
    console.log(`✅ Pipeline worker job completed: ${job.id}`);
    logger.info({ msg: 'Pipeline worker job completed', jobId: job.id, jobName: job.name, result });
  });

  worker.on('failed', (job, err) => {
    console.log(`🔴 Pipeline worker job failed: ${job?.id}, Error: ${err.message}`);
    logger.error({
      msg: 'Pipeline worker job failed',
      jobId: job?.id,
      jobName: job?.name,
      error: err.message,
      attemptsMade: job?.attemptsMade,
    });
  });

  worker.on('error', err => {
    console.log(`🔴 Pipeline worker error: ${err.message}`);
    logger.error({ msg: 'Pipeline worker error', error: err.message });
  });

  worker.on('stalled', jobId => {
    console.log(`⚠️ Pipeline worker job stalled: ${jobId}`);
    logger.warn({ msg: 'Pipeline worker job stalled — BullMQ will re-queue', jobId });
  });

  logger.info({
    msg: 'Pipeline worker created',
    queue: QUEUE_NAMES.PIPELINE_JOBS,
    concurrency: 3,
  });

  return worker;
}

export default { createPipelineWorker };

// =============================================================================
// Auto-start when executed directly
// =============================================================================

import { fileURLToPath } from 'url';
import { resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const entrypoint = resolve(process.argv[1]);

if (resolve(__filename) === entrypoint) {
  console.log('\n========================================');
  console.log('🚀 Starting Pipeline Worker');
  console.log('========================================\n');

  const worker = createPipelineWorker();

  console.log('✅ Pipeline Worker created and waiting for jobs');
  console.log(`📡 Queue: ${QUEUE_NAMES.PIPELINE_JOBS}`);
  console.log(`🔄 Concurrency: 3`);
  console.log('\n⏳ Waiting for jobs...\n');

  process.on('SIGTERM', async () => {
    console.log('\n⚠️ Received SIGTERM, closing worker...');
    await worker.close();
    console.log('✅ Worker closed');
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    console.log('\n⚠️ Received SIGINT, closing worker...');
    await worker.close();
    console.log('✅ Worker closed');
    process.exit(0);
  });
}
