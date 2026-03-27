// =============================================================================
// workers/design.worker.js — FIXED
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
import { prisma } from '#config/database/prisma.js';
import { uploadFile } from '#services/storage/storage.service.js';

const WORKER_NAME = 'design-worker';
const BATCH_SIZE = 25;

async function renderCardDesign(cardData, template) {
  const designData = {
    cardNumber: cardData.card_number,
    studentName: cardData.studentName,
    studentClass: cardData.studentClass,
    studentSection: cardData.studentSection,
    studentPhoto: cardData.studentPhoto,
    qrUrl: cardData.qrUrl,
    schoolName: cardData.schoolName,
    schoolLogo: cardData.schoolLogo,
    backgroundColor: template?.background_color || '#FFFFFF',
    primaryColor: template?.primary_color || '#000000',
    textColor: template?.text_color || '#000000',
    qrDarkColor: template?.qr_dark_color || '#000000',
    qrLightColor: template?.qr_light_color || '#FFFFFF',
    showStudentName: template?.show_student_name ?? true,
    showClass: template?.show_class ?? true,
    showSchoolName: template?.show_school_name ?? true,
    showPhoto: template?.show_photo ?? true,
  };
  return Buffer.from(JSON.stringify(designData, null, 2), 'utf-8');
}

async function generateCardDesigns(orderId, stepExecutionId, jobId) {
  logger.info({ msg: 'Design generation started', orderId });

  const order = await prisma.cardOrder.findUnique({
    where: { id: orderId },
    include: {
      school: { include: { cardTemplate: true } },
      cards: {
        where: { file_url: null },
        include: {
          token: {
            include: { student: true, qrAsset: true, orderItem: true },
          },
        },
      },
    },
  });

  if (!order) throw new Error(`Order ${orderId} not found`);

  const pendingCards = order.cards.filter(c => !c.file_url);
  const template = order.school.cardTemplate;

  if (pendingCards.length === 0) {
    logger.info({ msg: 'No pending designs', orderId });
    return { generated: 0, complete: true };
  }

  await stepLog(
    stepExecutionId,
    orderId,
    'Starting card design generation',
    { pendingCount: pendingCards.length },
    jobId
  );

  logger.info({
    msg: 'Generating designs',
    orderId,
    pendingCount: pendingCards.length,
  });

  const generatedDesigns = [];
  const failedDesigns = [];

  for (let i = 0; i < pendingCards.length; i += BATCH_SIZE) {
    const batchCards = pendingCards.slice(i, i + BATCH_SIZE);

    logger.info({
      msg: 'Processing design batch',
      orderId,
      batchStart: i,
      batchEnd: Math.min(i + BATCH_SIZE, pendingCards.length),
    });

    const batchResults = await Promise.allSettled(
      batchCards.map(async card => {
        const token = card.token;
        const student = token?.student;
        const qrAsset = token?.qrAsset;
        const orderItem = token?.orderItem;

        const studentName = student?.first_name
          ? `${student.first_name} ${student.last_name || ''}`.trim()
          : orderItem?.student_name || 'Student';
        const studentClass = student?.class || orderItem?.class || '';
        const studentSection = student?.section || orderItem?.section || '';
        const studentPhoto = student?.photo_url || orderItem?.photo_url || null;
        const qrUrl = qrAsset?.public_url || null;

        const designBuffer = await renderCardDesign(
          {
            card_number: card.card_number,
            studentName,
            studentClass,
            studentSection,
            studentPhoto,
            qrUrl,
            schoolName: order.school.name,
            schoolLogo: order.school.logo_url,
          },
          template
        );

        const storageKey = `cards/${order.school_id}/${orderId}/${card.id}.pdf`;
        const designUrl = await uploadFile({
          key: storageKey,
          body: designBuffer,
          contentType: 'application/pdf',
          cacheControl: 'public, max-age=31536000',
        });

        await prisma.card.update({
          where: { id: card.id },
          data: { file_url: designUrl, print_status: 'PENDING' },
        });

        return {
          cardId: card.id,
          cardNumber: card.card_number,
          designUrl,
        };
      })
    );

    for (const settled of batchResults) {
      if (settled.status === 'fulfilled') {
        generatedDesigns.push(settled.value);
      } else {
        logger.error({
          msg: 'Design generation failed for card',
          orderId,
          error: settled.reason?.message,
        });
        failedDesigns.push({ error: settled.reason?.message });
      }
    }
  }

  if (generatedDesigns.length > 0) {
    await prisma.cardOrder.update({
      where: { id: orderId },
      data: {
        card_design_files: {
          designs_generated: generatedDesigns.length,
          failed: failedDesigns.length,
          generated_at: new Date().toISOString(),
          sample_url: generatedDesigns[0]?.designUrl,
        },
        card_design_at: new Date(),
        card_design_by: 'system',
        status: 'CARD_DESIGN_READY',
      },
    });
  }

  logger.info({
    msg: 'Design generation completed',
    orderId,
    generated: generatedDesigns.length,
    failed: failedDesigns.length,
    total: pendingCards.length,
  });

  return {
    generated: generatedDesigns.length,
    failed: failedDesigns.length,
    total: pendingCards.length,
    sampleUrl: generatedDesigns[0]?.designUrl,
  };
}

async function processDesignGeneration(orderId, stepExecutionId, jobId) {
  const result = await generateCardDesigns(orderId, stepExecutionId, jobId);

  if (result.generated === 0) {
    logger.info({ msg: 'No new designs, skipping downstream', orderId });
    return result;
  }

  await transitionState(orderId, 'CARD_DESIGN_READY', 'system', result);

  await prisma.orderPipeline.update({
    where: { order_id: orderId },
    data: {
      current_step: 'CARD_DESIGN',
      overall_progress: 60,
    },
  });

  await publishEvent(ORDER_EVENTS.DESIGN_COMPLETED, orderId, result);

  return result;
}

export function createDesignWorker() {
  logger.info({ msg: 'Creating design worker' });

  const worker = new Worker(
    QUEUE_NAMES.PIPELINE,
    async job => {
      const { orderId, event, stepExecutionId, jobExecutionId } = job.data;

      // Only process CARD_GENERATED events
      if (event !== 'CARD_GENERATED') {
        return {
          skipped: true,
          reason: `Not a card generated event: ${event}`,
        };
      }

      logger.info({
        msg: 'Design worker received job',
        jobId: job.id,
        orderId,
        event,
      });

      // ✅ FIX: Add idempotency check
      const { claimed } = await claimExecution(orderId, 'design_generation');
      if (!claimed) {
        logger.info({
          msg: 'Design generation already claimed, skipping',
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
          if (!pipeline) {
            throw new Error(`Pipeline not found for order ${orderId}`);
          }
          stepExecution = await beginStepExecution(pipeline.id, orderId, 'CARD_DESIGN', 'system');
        } else {
          stepExecution = await prisma.orderStepExecution.findUnique({
            where: { id: stepExecutionId },
          });
        }

        if (!stepExecution) {
          throw new Error(`StepExecution not found: ${stepExecutionId}`);
        }

        const result = await processDesignGeneration(
          orderId,
          stepExecution.id,
          jobExecutionId || job.id
        );

        await completeStepExecution(stepExecution.id, result);
        await markCompleted(orderId, 'design_generation', result);

        logger.info({ msg: 'Design worker completed', jobId: job.id, orderId });
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
            `Design generation failed: ${error.message}`,
            {},
            jobExecutionId || job.id
          );
          await failStepExecution(stepExecution.id, error);
        }

        await releaseClaim(orderId, 'design_generation');
        await publishFailure(orderId, 'CARD_DESIGN', error, {
          jobId: job.id,
        });
        throw error;
      }
    },
    {
      connection: { client: createWorkerRedisClient('worker-design') },
      concurrency: 2,
      settings: {
        stalledInterval: 90000,
        maxStalledCount: 3,
        lockDuration: 180000,
      },
    }
  );

  worker.on('completed', job => logger.info({ msg: 'Design worker job completed', jobId: job.id }));
  worker.on('failed', (job, err) =>
    logger.error({
      msg: 'Design worker job failed',
      jobId: job?.id,
      error: err.message,
    })
  );

  logger.info({ msg: 'Design worker created' });
  return worker;
}
