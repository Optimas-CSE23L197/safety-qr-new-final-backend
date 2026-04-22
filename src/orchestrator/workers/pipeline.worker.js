// src/orchestrator/workers/pipeline.worker.js
// Unified Pipeline Worker — Handles token generation for BLANK and PRE_DETAILS orders
// =============================================================================

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

const TOKEN_BATCH_SIZE = 50;
const QR_PARALLEL = 10;

async function generateTokens(orderId, stepExecutionId, jobId) {
  logger.info({ msg: 'Token generation started', orderId });

  try {
    const orderMeta = await prisma.cardOrder.findUnique({
      where: { id: orderId },
      select: { order_type: true },
    });

    if (!orderMeta) throw new Error(`Order ${orderId} not found`);

    const isBlank = orderMeta.order_type === 'BLANK';
    const isPreDetails = orderMeta.order_type === 'PRE_DETAILS';

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

    if (totalStudents === 0) {
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

    const existingTokens = await prisma.token.count({ where: { order_id: orderId } });
    if (existingTokens > 0) {
      await prisma.token.deleteMany({ where: { order_id: orderId } });
      await prisma.card.deleteMany({ where: { order_id: orderId } });
      await prisma.qrAsset.deleteMany({ where: { order_id: orderId } });
    }

    const tokenBatch = await prisma.tokenBatch.create({
      data: {
        school_id: order.school_id,
        order_id: orderId,
        count: totalStudents,
        status: 'PROCESSING',
        created_by: 'system',
      },
    });

    const cardNumbers = batchGenerateCardNumbers(order.school.serial_number, totalStudents);

    let generatedCount = 0;
    let failedCount = 0;

    const processItems = isBlank
      ? Array.from({ length: totalStudents }, (_, idx) => ({
          id: `blank-${idx}`,
          student_id: null,
          student_name: null,
          class: null,
          section: null,
        }))
      : (order.items ?? []);

    let storage;
    try {
      storage = getStorage();
    } catch (e) {
      await initializeStorage({
        ENDPOINT: process.env.AWS_S3_ENDPOINT,
        BUCKET: process.env.AWS_S3_BUCKET,
        ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
        SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
        CDN_DOMAIN: process.env.AWS_CDN_DOMAIN,
      });
      storage = getStorage();
    }

    for (let batchStart = 0; batchStart < totalStudents; batchStart += TOKEN_BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + TOKEN_BATCH_SIZE, totalStudents);
      const batchItems = processItems.slice(batchStart, batchEnd);
      const batchCardNumbers = cardNumbers.slice(batchStart, batchEnd);

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

      await prisma.token.createMany({ data: tokenData });

      const tokens = await prisma.token.findMany({
        where: { order_id: orderId, batch_id: tokenBatch.id },
        orderBy: { created_at: 'asc' },
        skip: batchStart,
        take: batchItems.length,
      });

      const rawTokenMap = new Map();
      for (let i = 0; i < tokens.length; i++) {
        rawTokenMap.set(tokens[i].id, rawTokens[i]);
      }

      const recoveryKey = `pipeline:recovery:${orderId}:${tokenBatch.id}:${batchStart}`;
      await workerRedis.setex(recoveryKey, 3600, JSON.stringify(Array.from(rawTokenMap.entries())));

      const qrResults = [];

      for (let j = 0; j < tokens.length; j += QR_PARALLEL) {
        const chunk = tokens.slice(j, j + QR_PARALLEL);

        const chunkResults = await Promise.allSettled(
          chunk.map(async (token, idx) => {
            try {
              const item = batchItems[j + idx];
              const cardNumber = batchCardNumbers[j + idx];
              const rawTokenValue = rawTokenMap.get(token.id);

              const scanUrl = buildScanUrl(token.id);
              const qrBuffer = await generateQrPng(scanUrl);

              const studentIdForPath = item.student_id || token.id;
              const qrKey = StoragePath.studentQrCode(order.school_id, studentIdForPath);

              const { location: qrUrl } = await storage.upload(qrBuffer, qrKey, {
                contentType: 'image/png',
                cacheControl: 'public, max-age=31536000',
              });

              return { token, item, rawToken: rawTokenValue, cardNumber, scanUrl, qrUrl };
            } catch (err) {
              throw err;
            }
          })
        );

        for (const settled of chunkResults) {
          if (settled.status === 'fulfilled') {
            qrResults.push(settled.value);
          } else {
            failedCount++;
          }
        }

        await updateStepProgress(
          stepExecutionId,
          Math.floor(((batchStart + j + chunk.length) / totalStudents) * 100),
          { processed: batchStart + j + chunk.length, total: totalStudents }
        );
      }

      if (qrResults.length > 0) {
        await prisma.$transaction(async tx => {
          for (const result of qrResults) {
            await tx.qrAsset.create({
              data: {
                token_id: result.token.id,
                school_id: order.school_id,
                storage_key: StoragePath.studentQrCode(
                  order.school_id,
                  result.item.student_id || result.token.id
                ),
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

        generatedCount += qrResults.length;
      }

      await workerRedis.del(recoveryKey);

      await stepLog(
        stepExecutionId,
        orderId,
        `Batch ${batchStart + 1}-${Math.min(batchEnd, totalStudents)} processed`,
        { generated: qrResults.length, failed: batchItems.length - qrResults.length },
        jobId
      );
    }

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

    if (generatedCount === totalStudents && generatedCount > 0) {
      await prisma.cardOrder.update({
        where: { id: orderId },
        data: {
          pipeline_completed_count: generatedCount,
          pipeline_started_at: new Date(),
          tokens_generated_at: new Date(),
          status: 'TOKEN_GENERATED',
        },
      });

      // FIXED: removed 'from' parameter
      await applyTransition({
        orderId,
        to: ORDER_STATUS.TOKEN_GENERATED,
        actorId: 'SYSTEM',
        actorType: 'WORKER',
        schoolId: order.school_id,
        meta: { generated: generatedCount, failed: failedCount },
        eventPayload: { orderNumber: order.order_number, tokenCount: generatedCount },
      });

      await publishEvent(EVENTS.ORDER_TOKEN_GENERATION_COMPLETE, orderId, {
        orderId,
        generatedCount,
        total: totalStudents,
      });

      if (!isBlank) {
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
      }
    } else if (generatedCount > 0 && generatedCount < totalStudents) {
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
      logger.error({ msg: 'Token generation completely failed', orderId, failedCount });
      throw new Error(`Token generation failed for order ${orderId}`);
    }

    logger.info({ msg: 'Token generation completed', orderId, generatedCount, failedCount });

    return {
      batchId: tokenBatch.id,
      generatedCount,
      failedCount,
      total: totalStudents,
      batchStatus,
    };
  } catch (error) {
    throw error;
  }
}

export async function processPipelineJob(job) {
  const jobName = job.name;
  const { orderId, stepExecutionId, jobExecutionId, event } = job.data;

  logger.info({
    msg: 'Pipeline worker processing job',
    jobId: job.id,
    jobName,
    event,
    orderId,
  });

  const validEvents = [EVENTS.ORDER_ADVANCE_PAYMENT_RECEIVED, EVENTS.ORDER_CONFIRMED];

  if (!orderId) {
    logger.warn({ msg: 'Job missing orderId, skipping', jobId: job.id });
    return { skipped: true, reason: 'Missing orderId' };
  }

  if (!validEvents.includes(event)) {
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

  const { claimed } = await claimExecution(orderId, 'token_generation');
  if (!claimed) {
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

export function createPipelineWorker() {
  const worker = new Worker(
    QUEUE_NAMES.PIPELINE_JOBS,
    async job => {
      return processPipelineJob(job);
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
    logger.info({ msg: 'Pipeline worker job completed', jobId: job.id, jobName: job.name, result });
  });

  worker.on('failed', (job, err) => {
    logger.error({
      msg: 'Pipeline worker job failed',
      jobId: job?.id,
      jobName: job?.name,
      error: err.message,
      attemptsMade: job?.attemptsMade,
    });
  });

  worker.on('error', err => {
    logger.error({ msg: 'Pipeline worker error', error: err.message });
  });

  logger.info({
    msg: 'Pipeline worker created',
    queue: QUEUE_NAMES.PIPELINE_JOBS,
    concurrency: 3,
  });

  return worker;
}

export default { createPipelineWorker };
