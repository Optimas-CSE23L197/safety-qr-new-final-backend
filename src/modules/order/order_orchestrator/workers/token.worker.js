// =============================================================================
// workers/token.worker.js — PRODUCTION READY with Debug Logs
// =============================================================================

import { Worker } from 'bullmq';
import { createWorkerRedisClient } from '#config/redis.js';
import { logger } from '#config/logger.js';
import { QUEUE_NAMES } from './orchestrator.constants.js';
import { prisma } from '#config/database/prisma.js';
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
import {
  generateRawToken,
  hashRawToken,
  buildScanUrl,
  batchGenerateCardNumbers,
} from '#services/token/token.helpers.js';
import { generateQrPng as generateQrImage } from '#services/qr/qr.service.js';
import { uploadFile } from '#services/storage/storage.service.js';

const WORKER_NAME = 'token-worker';
const BATCH_SIZE = 50;
const PARALLEL_QR = 10;

async function processTokenGeneration(orderId, stepExecutionId, jobId) {
  console.log('🔥🔥🔥 TOKEN WORKER STARTED 🔥🔥🔥');
  console.log(`OrderId: ${orderId}`);
  console.log(`StepExecutionId: ${stepExecutionId}`);
  console.log(`JobId: ${jobId}`);

  logger.info({ msg: 'Token generation started', orderId });

  // 1. Fetch order
  console.log('📦 STEP 1: Fetching order...');
  const order = await prisma.cardOrder.findUnique({
    where: { id: orderId },
    include: {
      school: { select: { id: true, serial_number: true } },
      items: { where: { status: 'PENDING' }, orderBy: { created_at: 'asc' } },
    },
  });

  if (!order) {
    console.error(`❌ Order ${orderId} not found!`);
    throw new Error(`Order ${orderId} not found`);
  }

  console.log(`✅ Order found:`, {
    id: order.id,
    order_number: order.order_number,
    order_type: order.order_type,
    card_count: order.card_count,
    school_id: order.school_id,
    school_serial: order.school?.serial_number,
  });

  // 2. Idempotency: skip if already generated
  console.log('🔍 STEP 2: Checking existing tokens...');
  const existingTokens = await prisma.token.count({
    where: { order_id: orderId },
  });
  console.log(`Existing tokens: ${existingTokens}, Expected: ${order.card_count}`);

  if (existingTokens >= order.card_count) {
    console.log(`⏭️ Tokens already exist, skipping generation`);
    logger.info({
      msg: 'Tokens already exist, skipping generation',
      orderId,
      existingTokens,
      expected: order.card_count,
    });
    return { skipped: true, existingTokens };
  }

  await stepLog(
    stepExecutionId,
    orderId,
    'Starting token generation',
    {
      cardCount: order.card_count,
      orderType: order.order_type,
      existingTokens,
    },
    jobId
  );

  const total = order.card_count;
  const isPreDetails = order.order_type === 'PRE_DETAILS';
  console.log(`📊 Order stats: total=${total}, isPreDetails=${isPreDetails}`);

  // 3. Create token batch
  console.log('📝 STEP 3: Creating token batch...');
  const tokenBatch = await prisma.tokenBatch.create({
    data: {
      school_id: order.school_id,
      order_id: orderId,
      count: total,
      status: 'PROCESSING',
      created_by: 'system',
    },
  });
  console.log(`✅ Token batch created: ${tokenBatch.id}`);
  logger.info({ msg: 'Token batch created', batchId: tokenBatch.id, orderId });

  // 4. Generate card numbers upfront
  console.log('🔢 STEP 4: Generating card numbers...');
  const cardNumbers = batchGenerateCardNumbers(order.school.serial_number, total);
  console.log(`✅ Generated ${cardNumbers.length} card numbers`);

  let generatedCount = existingTokens;
  let failedCount = 0;

  // 5. Process in batches
  console.log(`🚀 STEP 5: Processing batches (BATCH_SIZE=${BATCH_SIZE})...`);
  for (let batchStart = 0; batchStart < total; batchStart += BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + BATCH_SIZE, total);
    console.log(`\n📦 Processing batch ${batchStart}-${batchEnd}...`);

    // 5.1: Build token data for bulk insert
    const rawTokens = [];
    const tokenData = [];

    for (let idx = batchStart; idx < batchEnd; idx++) {
      const orderItem = isPreDetails ? order.items[idx] : null;
      const rawToken = generateRawToken();
      rawTokens.push(rawToken);

      tokenData.push({
        school_id: order.school_id,
        order_id: orderId,
        batch_id: tokenBatch.id,
        token_hash: hashRawToken(rawToken),
        status: isPreDetails ? 'ACTIVE' : 'UNASSIGNED',
        student_id: orderItem?.student_id || null,
        order_item_id: orderItem?.id || null,
        assigned_at: orderItem ? new Date() : null,
        activated_at: orderItem ? new Date() : null,
        expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      });
    }

    console.log(`  📝 Created ${tokenData.length} token records for batch`);

    // 5.2: Bulk insert tokens
    console.log(`  💾 Bulk inserting tokens...`);
    await prisma.token.createMany({ data: tokenData });
    console.log(`  ✅ Tokens inserted`);

    // 5.3: Fetch back the tokens with DB-assigned IDs
    console.log(`  🔍 Fetching inserted tokens...`);
    const tokens = await prisma.token.findMany({
      where: { order_id: orderId, batch_id: tokenBatch.id },
      orderBy: { created_at: 'asc' },
      skip: batchStart,
      take: batchEnd - batchStart,
    });
    console.log(`  ✅ Fetched ${tokens.length} tokens`);

    // 5.4: Generate QR codes in parallel chunks
    console.log(`  📱 Generating QR codes (PARALLEL_QR=${PARALLEL_QR})...`);
    const qrResults = [];

    for (let j = 0; j < tokens.length; j += PARALLEL_QR) {
      const chunk = tokens.slice(j, j + PARALLEL_QR);
      console.log(`    🧩 Processing QR chunk ${j}-${j + chunk.length}...`);

      const chunkResults = await Promise.allSettled(
        chunk.map(async (token, idx) => {
          const globalIdx = batchStart + j + idx;
          const scanUrl = buildScanUrl(token.id);
          console.log(`      🔗 Token ${token.id}: scanUrl=${scanUrl}`);

          const qrBuffer = await generateQrImage(scanUrl);
          console.log(`      📷 Token ${token.id}: QR buffer size=${qrBuffer.length}`);

          const storageKey = `qr/${order.school_id}/${orderId}/${token.id}.png`;
          const qrUrl = await uploadFile({
            key: storageKey,
            body: qrBuffer,
            contentType: 'image/png',
          });
          console.log(`      ☁️ Token ${token.id}: uploaded to ${qrUrl}`);

          return {
            token,
            qrUrl,
            storageKey,
            cardNumber: cardNumbers[globalIdx],
          };
        })
      );

      for (const settled of chunkResults) {
        if (settled.status === 'fulfilled') {
          qrResults.push(settled.value);
          console.log(`      ✅ QR generated for token ${settled.value.token.id}`);
        } else {
          console.error(`      ❌ QR generation failed: ${settled.reason?.message}`);
          logger.error({
            msg: 'QR generation failed for token in chunk',
            orderId,
            error: settled.reason?.message,
          });
        }
      }
    }

    console.log(`  📊 Batch QR results: ${qrResults.length} successful`);

    // 5.5: Bulk insert QR assets
    if (qrResults.length > 0) {
      console.log(`  💾 Bulk inserting QR assets...`);
      await prisma.qrAsset.createMany({
        data: qrResults.map(r => ({
          token_id: r.token.id,
          school_id: order.school_id,
          storage_key: r.storageKey,
          public_url: r.qrUrl,
          format: 'PNG',
          width_px: 512,
          height_px: 512,
          qr_type: isPreDetails ? 'PRE_DETAILS' : 'BLANK',
          generated_by: 'system',
          order_id: orderId,
          is_active: true,
        })),
      });
      console.log(`  ✅ QR assets inserted`);

      // 5.6: Bulk insert card stubs
      console.log(`  💳 Bulk inserting card stubs...`);
      await prisma.card.createMany({
        data: qrResults.map(r => ({
          school_id: order.school_id,
          student_id: r.token.student_id,
          token_id: r.token.id,
          order_id: orderId,
          card_number: r.cardNumber,
          print_status: 'PENDING',
        })),
      });
      console.log(`  ✅ Cards inserted`);

      generatedCount += qrResults.length;
      failedCount += batchEnd - batchStart - qrResults.length;
    }

    console.log(`📊 Batch progress: generated=${generatedCount}/${total}, failed=${failedCount}`);
  }

  // 6. Finalise token batch
  console.log('🏁 STEP 6: Finalizing token batch...');
  const batchStatus = failedCount === 0 ? 'COMPLETE' : generatedCount > 0 ? 'PARTIAL' : 'FAILED';

  await prisma.tokenBatch.update({
    where: { id: tokenBatch.id },
    data: {
      status: batchStatus,
      generated_count: generatedCount,
      failed_count: failedCount,
      completed_at: new Date(),
    },
  });
  console.log(`✅ Token batch finalized: status=${batchStatus}`);

  // 7. Transition order status
  console.log('🔄 STEP 7: Transitioning order state...');
  await transitionState(orderId, 'TOKEN_GENERATED', 'system', {
    generatedCount,
    failedCount,
  });
  console.log(`✅ State transitioned to TOKEN_GENERATED`);

  // 8. Update order record
  console.log('📝 STEP 8: Updating order record...');
  await prisma.cardOrder.update({
    where: { id: orderId },
    data: {
      status: 'TOKEN_GENERATED',
      tokens_generated_at: new Date(),
      tokens_generated_by: 'system',
    },
  });
  console.log(`✅ Order updated`);

  // 9. Publish event to trigger design worker
  console.log('📢 STEP 9: Publishing TOKEN_GENERATED event...');
  await publishEvent(ORDER_EVENTS.TOKEN_GENERATED, orderId, {
    orderId,
    generatedCount,
    failedCount,
  });
  console.log(`✅ Event published`);

  logger.info({
    msg: 'Token generation completed',
    orderId,
    generatedCount,
    failedCount,
    batchStatus,
  });

  console.log('🎉🎉🎉 TOKEN WORKER COMPLETED SUCCESSFULLY 🎉🎉🎉');
  console.log(`Summary: ${generatedCount} tokens generated, ${failedCount} failed`);

  return {
    batchId: tokenBatch.id,
    generatedCount,
    failedCount,
    batchStatus,
  };
}

export function createTokenWorker() {
  logger.info({ msg: 'Creating token worker' });

  const worker = new Worker(
    QUEUE_NAMES.TOKEN, // ← FIXED: Listen on main pipeline queue
    async job => {
      console.log('🔥🔥🔥 TOKEN WORKER JOB RECEIVED 🔥🔥🔥');
      console.log('Job data:', JSON.stringify(job.data, null, 2));

      const { orderId, jobExecutionId, event } = job.data;

      // Only process token generation events
      // Token generation should start after:
      // 1. Order is approved (for advance payment flow)
      // 2. Advance payment is received (for immediate flow)
      if (event !== 'ADVANCE_PAYMENT_RECEIVED' && event !== 'ORDER_APPROVED') {
        console.log(`⏭️ Skipping event: ${event} - not a token generation trigger`);
        return {
          skipped: true,
          reason: `Token worker only processes token generation events, got: ${event}`,
        };
      }

      console.log(`✅ Processing token generation for order ${orderId}`);
      logger.info({
        msg: 'Token worker received job',
        jobId: job.id,
        orderId,
        event,
      });

      // Idempotency guard
      console.log('🔒 Checking idempotency...');
      const { claimed } = await claimExecution(orderId, 'token_generation');
      if (!claimed) {
        console.log(`⏭️ Token generation already claimed, skipping`);
        logger.info({
          msg: 'Token generation already claimed, skipping',
          orderId,
        });
        return { skipped: true, reason: 'Already processed' };
      }
      console.log(`✅ Idempotency claimed`);

      let stepExecution = null;

      try {
        // Locate or create pipeline record
        console.log('🔍 Looking for pipeline...');
        let pipeline = await prisma.orderPipeline.findFirst({
          where: { order_id: orderId },
        });

        if (!pipeline) {
          console.log(`Creating pipeline for order ${orderId}`);
          pipeline = await prisma.orderPipeline.create({
            data: {
              order_id: orderId,
              current_step: 'TOKEN_GENERATION',
              overall_progress: 35,
              started_at: new Date(),
            },
          });
        }
        console.log(`✅ Pipeline found/created: ${pipeline.id}`);

        console.log('📝 Creating step execution...');
        stepExecution = await beginStepExecution(
          pipeline.id,
          orderId,
          'TOKEN_GENERATION',
          'system'
        );
        console.log(`✅ Step execution created: ${stepExecution.id}`);

        console.log('🚀 Starting token generation process...');
        const result = await processTokenGeneration(
          orderId,
          stepExecution.id,
          jobExecutionId || job.id
        );

        console.log('✅ Completing step execution...');
        await completeStepExecution(stepExecution.id, result);

        console.log('✅ Marking completed in idempotency...');
        await markCompleted(orderId, 'token_generation', result);

        console.log(`✅ Token worker completed for order ${orderId}`);
        logger.info({ msg: 'Token worker completed', jobId: job.id, orderId });
        return result;
      } catch (error) {
        console.error(`❌❌❌ TOKEN WORKER FAILED ❌❌❌`);
        console.error(`Error: ${error.message}`);
        console.error(`Stack: ${error.stack}`);

        logger.error({
          msg: 'Token worker failed',
          jobId: job.id,
          orderId,
          error: error.message,
          stack: error.stack,
        });

        if (stepExecution) {
          console.log(`📝 Logging step error...`);
          await stepError(
            stepExecution.id,
            orderId,
            `Token generation failed: ${error.message}`,
            {},
            jobExecutionId || job.id
          );
          await failStepExecution(stepExecution.id, error);
        }

        console.log(`🔓 Releasing idempotency claim...`);
        await releaseClaim(orderId, 'token_generation');

        console.log(`📢 Publishing failure event...`);
        await publishFailure(orderId, 'TOKEN_GENERATION', error, {
          jobId: job.id,
        });

        throw error;
      }
    },
    {
      connection: { client: createWorkerRedisClient('worker-token') },
      concurrency: 1,
      settings: {
        stalledInterval: 60000,
        maxStalledCount: 3,
        lockDuration: 300000,
      },
    }
  );

  worker.on('completed', (job, result) => {
    console.log(`✅ Worker job completed: ${job.id}`);
    logger.info({ msg: 'Token worker job completed', jobId: job.id, result });
  });

  worker.on('failed', (job, err) => {
    console.error(`❌ Worker job failed: ${job?.id} - ${err.message}`);
    logger.error({
      msg: 'Token worker job failed',
      jobId: job?.id,
      error: err.message,
    });
  });

  worker.on('error', err => {
    console.error(`❌ Worker error: ${err.message}`);
  });

  logger.info({ msg: 'Token worker created' });
  return worker;
}
