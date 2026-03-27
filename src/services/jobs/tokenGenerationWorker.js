// =============================================================================
// tokenGenerationWorker.js — RESQID
// BullMQ worker for step 4: token + QR + Card generation.
// =============================================================================

import { Worker } from 'bullmq';
import Redis from 'ioredis';
import { prisma } from '#config/database/prisma.js';
import { logger } from '#config/logger.js';
import {
  generateRawToken,
  hashRawToken,
  buildScanUrl,
  generateCardNumber,
  calculateExpiry,
} from '#services/token/token.helpers.js';
import { generateQrPng } from '#services/qr/qr.service.js';
import { uploadFile } from '#services/storage/storage.service.js';
import * as pipelineRepo from '#modules/order/pipeline/pipeline.repository.js';
import * as orderRepo from '#modules/order/order.repository.js';

// ─────────────────────────────────────────────────────────────────────────────
// DEDICATED REDIS CONNECTION FOR BULLMQ (NO KEY PREFIX)
// ─────────────────────────────────────────────────────────────────────────────

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

const bullRedisConnection = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  connectTimeout: 10000,
  commandTimeout: 5000,
  keepAlive: 30000,
  retryStrategy: times => {
    if (times > 20) return null;
    const delay = Math.min(100 * Math.pow(2, times), 30000);
    logger.warn({ attempt: times, delay }, `BullMQ Redis reconnecting in ${delay}ms`);
    return delay;
  },
  reconnectOnError: err => {
    const targetErrors = ['READONLY', 'ECONNRESET', 'ECONNREFUSED'];
    if (targetErrors.some(e => err.message.includes(e))) return 2;
    return false;
  },
  // IMPORTANT: NO keyPrefix here
});

bullRedisConnection.on('connect', () => {
  logger.info('BullMQ Worker Redis: connected');
});

bullRedisConnection.on('error', err => {
  logger.error({ err: err.message }, 'BullMQ Worker Redis: error');
});

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const QR_CONCURRENCY = 10;
const DB_CHUNK_SIZE = 50;
const PROGRESS_PUBLISH_EVERY = 25;
const STALL_THRESHOLD_MS = 30 * 60 * 1000;

// ─────────────────────────────────────────────────────────────────────────────
// WORKER DEFINITION
// ─────────────────────────────────────────────────────────────────────────────

export const tokenGenerationWorker = new Worker(
  'token-generation',
  async job => {
    const { jobExecutionId, orderId, batchId, schoolId, cardCount, isPreDetails, adminId, ip } =
      job.data;

    logger.info(`[worker:token] START job=${job.id} order=${orderId} count=${cardCount}`);

    // ── 1. Mark job + step as RUNNING ─────────────────────────────────────────
    const jobExec = await prisma.jobExecution.findUnique({
      where: { id: jobExecutionId },
      select: { step_execution_id: true },
    });

    await Promise.all([
      pipelineRepo.markJobRunning(jobExecutionId),
      pipelineRepo.markStepRunning(jobExec.step_execution_id),
    ]);

    await pipelineRepo.writeStepLog(
      jobExec.step_execution_id,
      orderId,
      'info',
      `Token generation started for ${cardCount} cards`,
      { cardCount, isPreDetails }
    );

    // ── 2. Idempotency: find already-generated tokens for this batch ──────────
    const existingTokenIds = await prisma.token.findMany({
      where: { order_id: orderId, batch_id: batchId },
      select: { id: true },
    });
    const alreadyGenerated = existingTokenIds.length;

    if (alreadyGenerated >= cardCount) {
      logger.info(`[worker:token] Already complete: order=${orderId} existing=${alreadyGenerated}`);
      await finalizeSuccess(
        job,
        jobExecutionId,
        jobExec.step_execution_id,
        orderId,
        batchId,
        adminId,
        cardCount,
        0
      );
      return { tokenCount: alreadyGenerated, failedCount: 0, skipped: true };
    }

    // Partial recovery: if some tokens exist, only generate the remainder
    const remainingCount = cardCount - alreadyGenerated;
    const startIndex = alreadyGenerated;

    if (alreadyGenerated > 0) {
      logger.warn(
        `[worker:token] Partial recovery: generating ${remainingCount} remaining (${alreadyGenerated} exist)`
      );
      await pipelineRepo.writeStepLog(
        jobExec.step_execution_id,
        orderId,
        'warn',
        `Partial recovery: ${alreadyGenerated} tokens already exist, generating ${remainingCount} remaining`
      );
    }

    // ── 3. Load order and school ───────────────────────────────────────────────
    const order = await orderRepo.findOrderById(orderId);
    if (!order?.school) throw new Error('Order or school not found');

    const school = order.school;
    const validityMonths = school.settings?.token_validity_months ?? 12;
    const qrType = isPreDetails ? 'PRE_DETAILS' : 'BLANK';

    // Slice items for the remaining tokens (PRE_DETAILS only)
    const itemsToProcess = isPreDetails ? (order.items ?? []).slice(startIndex) : [];

    // ── 4. Generate token hashes in memory ────────────────────────────────────
    const tokenPairs = Array.from({ length: remainingCount }, (_, i) => ({
      tokenHash: hashRawToken(generateRawToken()),
      expiresAt: calculateExpiry(validityMonths),
      studentId: isPreDetails ? (itemsToProcess[i]?.student_id ?? null) : null,
      orderItemId: isPreDetails ? (itemsToProcess[i]?.id ?? null) : null,
    }));

    // ── 5. Bulk insert token rows (chunked) ───────────────────────────────────
    const createdTokens = [];
    for (let i = 0; i < tokenPairs.length; i += DB_CHUNK_SIZE) {
      const chunk = tokenPairs.slice(i, i + DB_CHUNK_SIZE);
      const created = await prisma.$transaction(
        chunk.map(({ tokenHash, expiresAt, studentId, orderItemId }) =>
          prisma.token.create({
            data: {
              school_id: schoolId,
              batch_id: batchId,
              order_id: orderId,
              order_item_id: orderItemId,
              student_id: studentId,
              token_hash: tokenHash,
              status: 'UNASSIGNED',
              expires_at: expiresAt,
            },
            select: { id: true, order_item_id: true },
          })
        )
      );
      createdTokens.push(...created);
    }

    logger.info(`[worker:token] ${createdTokens.length} Token rows inserted`);

    // ── 6. Generate card numbers in bulk ──────────────────────────────────────
    const cardNumberCandidates = Array.from({ length: createdTokens.length + 20 }, () =>
      generateCardNumber(school.serial_number)
    );
    const existingCards = await prisma.card.findMany({
      where: { card_number: { in: cardNumberCandidates } },
      select: { card_number: true },
    });
    const existingSet = new Set(existingCards.map(c => c.card_number));
    const uniqueCardNumbers = [...new Set(cardNumberCandidates)]
      .filter(n => !existingSet.has(n))
      .slice(0, createdTokens.length);

    if (uniqueCardNumbers.length < createdTokens.length) {
      throw new Error('Could not generate enough unique card numbers — retry');
    }

    // ── 7. QR generation + S3 upload (capped concurrency) ────────────────────
    const successOutputs = [];
    const failedTokenIds = [];
    let processed = 0;

    for (let i = 0; i < createdTokens.length; i += QR_CONCURRENCY) {
      const batch = createdTokens.slice(i, i + QR_CONCURRENCY);

      const results = await Promise.all(
        batch.map(async (token, j) => {
          const cardNumber = uniqueCardNumbers[i + j];
          const scanUrl = buildScanUrl(token.id);
          try {
            const pngBuffer = await generateQrPng(scanUrl);
            const storageKey = `qr/${schoolId}/${token.id}.png`;
            const publicUrl = await uploadFile({
              key: storageKey,
              body: pngBuffer,
              contentType: 'image/png',
            });
            return {
              token,
              cardNumber,
              scanUrl,
              storageKey,
              publicUrl,
              error: null,
            };
          } catch (err) {
            logger.error(`[worker:token] QR failed token=${token.id}: ${err.message}`);
            return { token, cardNumber, error: err.message };
          }
        })
      );

      for (const result of results) {
        if (result.error) {
          failedTokenIds.push(result.token.id);
        } else {
          successOutputs.push(result);
        }
        processed++;
      }

      // Progress reporting
      if (processed % PROGRESS_PUBLISH_EVERY === 0 || processed === createdTokens.length) {
        const pct = Math.round((processed / cardCount) * 100);
        const detail = {
          processed: processed + alreadyGenerated,
          total: cardCount,
          failed: failedTokenIds.length,
          phase: 'qr_upload',
        };

        await Promise.all([
          job.updateProgress(pct),
          pipelineRepo.updateStepProgress(jobExec.step_execution_id, pct, detail),
          pipelineRepo.updateJobProgress(jobExecutionId, pct),
          publishProgress(orderId, {
            step: 'TOKEN_GENERATION',
            pct,
            ...detail,
          }),
        ]);
      }
    }

    // ── 8. Bulk insert Card + QrAsset rows ────────────────────────────────────
    if (successOutputs.length > 0) {
      await prisma.$transaction([
        prisma.card.createMany({
          data: successOutputs.map(r => ({
            school_id: schoolId,
            student_id: r.token.student_id,
            token_id: r.token.id,
            order_id: orderId,
            card_number: r.cardNumber,
            file_url: null,
            print_status: 'PENDING',
          })),
          skipDuplicates: true,
        }),
        prisma.qrAsset.createMany({
          data: successOutputs.map(r => ({
            token_id: r.token.id,
            school_id: schoolId,
            storage_key: r.storageKey,
            public_url: r.publicUrl,
            format: 'PNG',
            qr_type: qrType,
            generated_by: adminId,
            order_id: orderId,
            is_active: true,
          })),
          skipDuplicates: true,
        }),
      ]);
    }

    // PRE_DETAILS: bulk update order items
    if (isPreDetails && successOutputs.length > 0) {
      const itemUpdates = successOutputs
        .filter(r => r.token.order_item_id)
        .map(r =>
          prisma.cardOrderItem.update({
            where: { id: r.token.order_item_id },
            data: {
              token_id: r.token.id,
              status: 'TOKEN_GENERATED',
              qr_generated: true,
            },
          })
        );
      for (let i = 0; i < itemUpdates.length; i += DB_CHUNK_SIZE) {
        await prisma.$transaction(itemUpdates.slice(i, i + DB_CHUNK_SIZE));
      }
    }

    // ── 9. Finalize TokenBatch ─────────────────────────────────────────────────
    await prisma.tokenBatch.update({
      where: { id: batchId },
      data: {
        status: failedTokenIds.length === 0 ? 'COMPLETE' : 'PARTIAL',
        generated_count: successOutputs.length + alreadyGenerated,
        failed_count: failedTokenIds.length,
        completed_at: new Date(),
        error_log: failedTokenIds.length > 0 ? { failed: failedTokenIds } : null,
      },
    });

    if (successOutputs.length === 0) {
      throw new Error(`All ${cardCount} QR jobs failed — check S3/QR service`);
    }

    // ── 10. Finalize ──────────────────────────────────────────────────────────
    await finalizeSuccess(
      job,
      jobExecutionId,
      jobExec.step_execution_id,
      orderId,
      batchId,
      adminId,
      successOutputs.length + alreadyGenerated,
      failedTokenIds.length
    );

    logger.info(
      `[worker:token] DONE order=${orderId} success=${successOutputs.length} failed=${failedTokenIds.length}`
    );

    return {
      tokenCount: successOutputs.length + alreadyGenerated,
      failedCount: failedTokenIds.length,
    };
  },
  {
    connection: bullRedisConnection, // ← Use the clean connection
    concurrency: 3,
    limiter: { max: 10, duration: 1000 },
    lockDuration: 5 * 60 * 1000,
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// WORKER EVENT HANDLERS
// ─────────────────────────────────────────────────────────────────────────────

tokenGenerationWorker.on('failed', async (job, err) => {
  if (!job) return;
  const { jobExecutionId, orderId } = job.data;

  logger.error(
    `[worker:token] FAILED job=${job.id} order=${orderId} attempt=${job.attemptsMade}: ${err.message}`
  );

  const jobExec = await prisma.jobExecution.findUnique({
    where: { id: jobExecutionId },
    select: { step_execution_id: true },
  });

  await Promise.all([
    pipelineRepo.markJobFailed(jobExecutionId, err, job.attemptsMade),
    job.attemptsMade >= job.opts.attempts
      ? pipelineRepo.markStepFailed(jobExec.step_execution_id, [
          { message: err.message, at: new Date().toISOString() },
        ])
      : Promise.resolve(),
    job.attemptsMade >= job.opts.attempts
      ? prisma.cardOrder.update({
          where: { id: orderId },
          data: { status: 'ADVANCE_RECEIVED' },
        })
      : Promise.resolve(),
  ]);

  await publishProgress(orderId, {
    step: 'TOKEN_GENERATION',
    status: job.attemptsMade >= job.opts.attempts ? 'FAILED' : 'RETRYING',
    error: err.message,
    attempt: job.attemptsMade,
  });
});

tokenGenerationWorker.on('error', err => {
  logger.error(`[worker:token] Worker error: ${err.message}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const finalizeSuccess = async (
  job,
  jobExecutionId,
  stepExecutionId,
  orderId,
  batchId,
  adminId,
  tokenCount,
  failedCount
) => {
  const resultSummary = { tokenCount, failedCount, batchId };

  await Promise.all([
    pipelineRepo.markJobCompleted(jobExecutionId, resultSummary),
    failedCount > 0
      ? pipelineRepo.markStepPartialFailed(stepExecutionId, resultSummary, [
          { message: `${failedCount} QR uploads failed` },
        ])
      : pipelineRepo.markStepCompleted(stepExecutionId, resultSummary),
    prisma.cardOrder.update({
      where: { id: orderId },
      data: {
        status: 'TOKEN_GENERATED',
        tokens_generated_at: new Date(),
        tokens_generated_by: adminId,
      },
    }),
    orderRepo.writeStatusLog({
      orderId,
      fromStatus: 'TOKEN_GENERATION',
      toStatus: 'TOKEN_GENERATED',
      changedBy: adminId,
      note:
        failedCount > 0
          ? `${tokenCount} tokens generated, ${failedCount} failed`
          : `${tokenCount} tokens generated`,
      metadata: {
        batch_id: batchId,
        token_count: tokenCount,
        failed_count: failedCount,
      },
    }),
  ]);

  await publishProgress(orderId, {
    step: 'TOKEN_GENERATION',
    status: failedCount > 0 ? 'PARTIAL_FAILED' : 'COMPLETED',
    pct: 100,
    tokenCount,
    failedCount,
  });
};

// Publish to Redis channel — SSE endpoint subscribes to this
const publishProgress = async (orderId, payload) => {
  try {
    // Use a separate Redis connection for pub/sub without prefix
    const pubRedis = new Redis(REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
    await pubRedis.publish(
      `pipeline:${orderId}:progress`,
      JSON.stringify({ ts: Date.now(), ...payload })
    );
    await pubRedis.quit();
  } catch (_) {
    // Non-fatal — progress push is best-effort
  }
};
