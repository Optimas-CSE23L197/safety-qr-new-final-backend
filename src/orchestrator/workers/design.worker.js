// src/orchestrator/workers/design.worker.js
// Design Worker — handles card design generation
// Implements Section 3 — Worker 4: design.worker.js
//
// MANUAL FLOW (Super Admin controlled):
//   1. Tokens generated → order state = TOKEN_COMPLETE
//   2. Super admin opens card design dashboard
//   3. Views preview of FIRST card with default template
//   4. Adjusts: QR position, name position, class position, logo, colors
//   5. Locks design → triggers design generation for ALL cards in order
//   6. Worker generates all cards (one per student)
//   7. Worker generates single PDF with all cards (print-ready)
//   8. Super admin downloads PDF
//   9. Sends PDF to vendor physically
//   10. Marks order as VENDOR_SENT
//
// Features:
//   - Single concurrency (CPU-intensive)
//   - Preview generation for design adjustments
//   - Batch card generation after design locked
//   - PDF compilation with all cards (print-ready)
//   - No auto-push to vendor — manual download + physical sending
//
// =============================================================================
// DESIGN SCALABILITY — HOW TO ADD CUSTOM SCHOOL DESIGNS LATER
// =============================================================================
//
// CURRENT: Uses default template with adjustable positions via API.
// FUTURE: To support per-school custom designs:
//
// 1. SCHEMA (already compatible):
//    - CardTemplate model exists with fields: logo_url, background_color,
//      primary_color, text_color, qr_dark_color, qr_light_color,
//      show_student_name, show_class, show_school_name, show_photo
//    - Add positioning fields to CardTemplate:
//        - qr_x_position Int?
//        - qr_y_position Int?
//        - qr_width Int?
//        - student_photo_x Int?
//        - student_photo_y Int?
//        - student_photo_width Int?
//        - student_photo_height Int?
//        - name_x Int?
//        - name_y Int?
//        - class_x Int?
//        - class_y Int?
//        - school_logo_x Int?
//        - school_logo_y Int?
//        - school_logo_width Int?
//        - card_width Int?
//        - card_height Int?
//
// 2. PREVIEW FLOW (already implemented):
//    - API endpoint: POST /api/v1/orders/:orderId/design/preview
//    - Accepts positioning config, returns preview image
//    - Super admin iterates until satisfied
//
// 3. LOCK DESIGN FLOW:
//    - POST /api/v1/orders/:orderId/design/lock
//    - Saves positioning config to CardOrder.design_config
//    - Triggers design worker job
//
// =============================================================================

import { Worker } from 'bullmq';
import sharp from 'sharp';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
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
import { uploadCardDesign } from '#infrastructure/storage/r2.upload.js';
import { generateQrPng } from '#services/qr.service.js';

// Default card dimensions
const CARD_WIDTH = 640;
const CARD_HEIGHT = 400;

// Default positioning (used when no custom config)
const DEFAULT_POSITIONS = {
  qr: { x: CARD_WIDTH - 130, y: CARD_HEIGHT - 130, size: 110 },
  studentPhoto: { x: 20, y: 60, size: 80 },
  studentName: { x: 120, y: 70, fontSize: 18 },
  studentClass: { x: 120, y: 110, fontSize: 14 },
  studentSection: { x: 120, y: 135, fontSize: 14 },
  schoolLogo: { x: 20, y: 20, size: 50 },
  schoolName: { x: 80, y: 30, fontSize: 16 },
};

/**
 * Get school's card template
 * @param {string} schoolId
 * @returns {Promise<object>}
 */
async function getCardTemplate(schoolId) {
  const template = await prisma.cardTemplate.findUnique({
    where: { school_id: schoolId },
  });

  return {
    background_color: template?.background_color || '#FFFFFF',
    primary_color: template?.primary_color || '#E8342A',
    text_color: template?.text_color || '#000000',
    qr_dark_color: template?.qr_dark_color || '#000000',
    qr_light_color: template?.qr_light_color || '#FFFFFF',
    show_student_name: template?.show_student_name ?? true,
    show_class: template?.show_class ?? true,
    show_school_name: template?.show_school_name ?? true,
    show_photo: template?.show_photo ?? true,
    logo_url: template?.logo_url || null,
  };
}

/**
 * Generate single card image using Sharp
 * @param {object} cardData - Student card data
 * @param {object} template - School template
 * @param {object} positions - Custom positions (from design config)
 * @returns {Promise<Buffer>}
 */
async function generateCardImage(cardData, template, positions = DEFAULT_POSITIONS) {
  const {
    cardNumber,
    studentName,
    studentClass,
    studentSection,
    studentPhotoUrl,
    qrCodeUrl,
    schoolName,
    schoolLogoUrl,
  } = cardData;

  // Create base card with background color
  let image = sharp({
    create: {
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      channels: 4,
      background: template.background_color,
    },
  }).png();

  const layers = [];

  // Add school logo if available
  if (template.show_school_name && schoolLogoUrl) {
    try {
      const logoBuffer = await fetch(schoolLogoUrl).then(r => r.buffer());
      layers.push({
        input: logoBuffer,
        top: positions.schoolLogo.y,
        left: positions.schoolLogo.x,
        width: positions.schoolLogo.size,
        height: positions.schoolLogo.size,
        blend: 'over',
      });
    } catch (err) {
      logger.warn({ msg: 'Failed to load school logo', url: schoolLogoUrl });
    }
  }

  // Add student photo if available
  if (template.show_photo && studentPhotoUrl) {
    try {
      const photoBuffer = await fetch(studentPhotoUrl).then(r => r.buffer());
      // Create circular mask for photo
      const circularMask = sharp({
        create: {
          width: positions.studentPhoto.size,
          height: positions.studentPhoto.size,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
      })
        .composite([
          {
            input: Buffer.from(
              `<svg width="${positions.studentPhoto.size}" height="${positions.studentPhoto.size}">
                <circle cx="${positions.studentPhoto.size / 2}" cy="${positions.studentPhoto.size / 2}" r="${positions.studentPhoto.size / 2}" fill="white"/>
              </svg>`
            ),
            blend: 'dest-in',
          },
        ])
        .png();

      const maskedPhoto = await sharp(photoBuffer)
        .resize(positions.studentPhoto.size, positions.studentPhoto.size, { fit: 'cover' })
        .composite([{ input: await circularMask.toBuffer(), blend: 'dest-in' }])
        .png()
        .toBuffer();

      layers.push({
        input: maskedPhoto,
        top: positions.studentPhoto.y,
        left: positions.studentPhoto.x,
        blend: 'over',
      });
    } catch (err) {
      logger.warn({ msg: 'Failed to load student photo', url: studentPhotoUrl });
    }
  }

  // Add QR code
  if (qrCodeUrl) {
    try {
      const qrBuffer = await fetch(qrCodeUrl).then(r => r.buffer());
      layers.push({
        input: qrBuffer,
        top: positions.qr.y,
        left: positions.qr.x,
        width: positions.qr.size,
        height: positions.qr.size,
        blend: 'over',
      });
    } catch (err) {
      logger.warn({ msg: 'Failed to load QR code', url: qrCodeUrl });
    }
  }

  // Composite all layers
  if (layers.length > 0) {
    image = image.composite(layers);
  }

  const cardImage = await image.toBuffer();

  // Add text overlay (Sharp doesn't support text well, so we'll use PDF-lib for text)
  // For now, return image without text — text will be added at PDF level
  return cardImage;
}

/**
 * Generate PDF with all cards (print-ready)
 * @param {Array} cards - Array of card images
 * @param {string} orderNumber - Order number for filename
 * @returns {Promise<Buffer>}
 */
async function generateCardsPdf(cards, orderNumber) {
  const pdfDoc = await PDFDocument.create();
  const pageWidth = 595; // A4 width
  const pageHeight = 842; // A4 height
  const cardsPerRow = 2;
  const cardsPerColumn = 4;
  const cardWidth = 250;
  const cardHeight = 160;
  const marginX = (pageWidth - cardsPerRow * cardWidth) / 3;
  const marginY = 50;

  let currentPage = pdfDoc.addPage([pageWidth, pageHeight]);
  let cardIndex = 0;

  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    const row = Math.floor(cardIndex / cardsPerRow);
    const col = cardIndex % cardsPerRow;

    const x = marginX + col * (cardWidth + marginX);
    const y = pageHeight - marginY - (row + 1) * (cardHeight + 20);

    // Embed card image
    const cardImage = await pdfDoc.embedPng(card);
    currentPage.drawImage(cardImage, {
      x,
      y,
      width: cardWidth,
      height: cardHeight,
    });

    cardIndex++;

    // Create new page if needed
    if (cardIndex % (cardsPerRow * cardsPerColumn) === 0 && i < cards.length - 1) {
      currentPage = pdfDoc.addPage([pageWidth, pageHeight]);
      cardIndex = 0;
    }
  }

  return Buffer.from(await pdfDoc.save());
}

/**
 * Generate preview card (single card for design adjustments)
 * Used by super admin to preview before locking design
 * @param {object} params
 * @returns {Promise<Buffer>}
 */
export async function generatePreviewCard(params) {
  const { orderId, studentId, positions = DEFAULT_POSITIONS, templateOverride = null } = params;

  const order = await prisma.cardOrder.findUnique({
    where: { id: orderId },
    include: { school: true },
  });

  if (!order) throw new Error(`Order ${orderId} not found`);

  const student = await prisma.student.findUnique({
    where: { id: studentId },
    include: { emergency: true },
  });

  const template = templateOverride || (await getCardTemplate(order.school_id));
  const qrCode = await generateQrPng(`https://resqid.in/s/${student?.scan_url || 'preview'}`);

  const cardData = {
    cardNumber: student?.card_number || 'PREVIEW-0001',
    studentName: student
      ? `${student.first_name} ${student.last_name || ''}`.trim()
      : 'Student Name',
    studentClass: student?.class || 'Class',
    studentSection: student?.section || 'Section',
    studentPhotoUrl: student?.photo_url,
    qrCodeUrl: null, // Will use generated QR buffer
    schoolName: order.school.name,
    schoolLogoUrl: order.school.logo_url,
  };

  // Generate QR buffer
  const qrBuffer = qrCode;

  // Create card image with QR buffer
  let image = sharp({
    create: {
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      channels: 4,
      background: template.background_color,
    },
  }).png();

  const layers = [];

  // Add QR code from buffer
  layers.push({
    input: qrBuffer,
    top: positions.qr.y,
    left: positions.qr.x,
    width: positions.qr.size,
    height: positions.qr.size,
    blend: 'over',
  });

  if (layers.length > 0) {
    image = image.composite(layers);
  }

  return image.toBuffer();
}

/**
 * Generate all cards for an order (called after design locked)
 * @param {string} orderId - Order ID
 * @param {string} stepExecutionId - Step execution ID
 * @param {string} jobId - Job ID
 * @param {object} designConfig - Locked design configuration (positions, colors, etc.)
 * @returns {Promise<{ generated: number, pdfUrl: string, failed: number }>}
 */
async function generateOrderCards(
  orderId,
  stepExecutionId,
  jobId,
  designConfig = DEFAULT_POSITIONS
) {
  logger.info({ msg: 'Card design generation started', orderId });

  // Fetch order with all items and their tokens/cards
  const order = await prisma.cardOrder.findUnique({
    where: { id: orderId },
    include: {
      school: true,
      items: {
        where: { pipeline_status: 'COMPLETE' },
        include: {
          student: true,
          token: {
            include: { qrAsset: true },
          },
          card: {
            where: { order_id: orderId },
            take: 1,
          },
        },
      },
    },
  });

  if (!order) throw new Error(`Order ${orderId} not found`);

  const pendingItems = order.items.filter(item => !item.card_design_url);
  const template = await getCardTemplate(order.school_id);

  if (pendingItems.length === 0) {
    logger.info({ msg: 'No pending card designs', orderId });
    return { generated: 0, pdfUrl: null, failed: 0 };
  }

  await stepLog(
    stepExecutionId,
    orderId,
    'Starting card design generation',
    { pendingCount: pendingItems.length, designConfig },
    jobId
  );

  const generatedCards = [];
  const failedCards = [];

  // Generate each card image
  for (let i = 0; i < pendingItems.length; i++) {
    const item = pendingItems[i];
    const card = item.card?.[0];

    if (!card) {
      logger.warn({ msg: 'No card found for order item', orderId, itemId: item.id });
      failedCards.push({ itemId: item.id, reason: 'No card record' });
      continue;
    }

    try {
      const student = item.student;
      const qrAsset = item.token?.qrAsset;

      const cardData = {
        cardNumber: card.card_number,
        studentName: student
          ? `${student.first_name} ${student.last_name || ''}`.trim()
          : item.student_name,
        studentClass: student?.class || item.class,
        studentSection: student?.section || item.section,
        studentPhotoUrl: student?.photo_url,
        qrCodeUrl: qrAsset?.public_url,
        schoolName: order.school.name,
        schoolLogoUrl: order.school.logo_url,
      };

      const cardImage = await generateCardImage(cardData, template, designConfig);

      // Upload to R2
      const { url: designUrl } = await uploadCardDesign({
        buffer: cardImage,
        schoolId: order.school_id,
        studentId: item.student_id || `preview-${item.id}`,
        cardNumber: card.card_number,
      });

      // Update card record
      await prisma.card.update({
        where: { id: card.id },
        data: { file_url: designUrl, print_status: 'PENDING' },
      });

      // Update order item
      await prisma.cardOrderItem.update({
        where: { id: item.id },
        data: { card_design_url: designUrl },
      });

      generatedCards.push({ cardId: card.id, cardNumber: card.card_number, designUrl });
    } catch (error) {
      logger.error({
        msg: 'Card design generation failed',
        orderId,
        itemId: item.id,
        error: error.message,
      });
      failedCards.push({ itemId: item.id, reason: error.message });
    }

    // Update progress
    await updateStepProgress(stepExecutionId, Math.floor(((i + 1) / pendingItems.length) * 100), {
      processed: i + 1,
      total: pendingItems.length,
    });
  }

  // Generate PDF with all successful cards
  let pdfUrl = null;
  if (generatedCards.length > 0) {
    // Fetch card images from R2
    const cardBuffers = [];
    for (const card of generatedCards) {
      const response = await fetch(card.designUrl);
      const buffer = await response.buffer();
      cardBuffers.push(buffer);
    }

    const pdfBuffer = await generateCardsPdf(cardBuffers, order.order_number);

    // Upload PDF to R2
    const storageKey = `cards-pdf/${order.school_id}/${orderId}/cards-${order.order_number}.pdf`;
    // Use existing upload function
    const { url } = await uploadCardDesign({
      buffer: pdfBuffer,
      schoolId: order.school_id,
      studentId: 'batch',
      cardNumber: order.order_number,
    });
    pdfUrl = url;
  }

  // Update order with design completion
  await prisma.cardOrder.update({
    where: { id: orderId },
    data: {
      design_completed_count: generatedCards.length,
      design_started_at: new Date(),
      card_design_files: {
        generated: generatedCards.length,
        failed: failedCards.length,
        pdfUrl,
        generatedAt: new Date().toISOString(),
      },
      card_design_at: new Date(),
      card_design_by: 'system',
      status: 'DESIGN_COMPLETE',
    },
  });

  logger.info({
    msg: 'Card design generation completed',
    orderId,
    generated: generatedCards.length,
    failed: failedCards.length,
    pdfUrl,
  });

  // Publish event for notification (super admin dashboard only, no auto vendor)
  await publishEvent(EVENTS.ORDER_CARD_DESIGN_COMPLETE, orderId, {
    orderId,
    generatedCount: generatedCards.length,
    failedCount: failedCards.length,
    pdfUrl,
    downloadReady: true,
  });

  return {
    generated: generatedCards.length,
    failed: failedCards.length,
    pdfUrl,
    total: pendingItems.length,
  };
}

// =============================================================================
// Main Job Processor
// =============================================================================

export async function processDesignJob(job) {
  const { orderId, stepExecutionId, jobExecutionId, event, designConfig } = job.data;

  logger.info({ msg: 'Design worker processing job', jobId: job.id, orderId, event });

  // Only process design lock events (manual trigger from super admin)
  if (event !== 'DESIGN_LOCKED') {
    return {
      skipped: true,
      reason: `Design worker only processes DESIGN_LOCKED events, got: ${event}`,
    };
  }

  // Idempotency guard
  const { claimed } = await claimExecution(orderId, 'design_generation');
  if (!claimed) {
    logger.info({ msg: 'Design generation already claimed, skipping', orderId });
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
          current_step: 'CARD_DESIGN',
          overall_progress: 50,
          started_at: new Date(),
        },
      });
    }

    stepExecution = await beginStepExecution(pipeline.id, orderId, 'CARD_DESIGN', 'system');

    const result = await generateOrderCards(
      orderId,
      stepExecution.id,
      jobExecutionId || job.id,
      designConfig || DEFAULT_POSITIONS
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
        `Card design generation failed: ${error.message}`,
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

// =============================================================================
// Worker Factory
// =============================================================================

export function createDesignWorker() {
  logger.info({ msg: 'Creating design worker' });

  const worker = new Worker(
    QUEUE_NAMES.JOBS_BACKGROUND,
    async job => {
      logger.info({ msg: 'Design worker received job', jobId: job.id, data: job.data });
      return processDesignJob(job);
    },
    {
      connection: workerRedis,
      concurrency: 1, // Single concurrency for CPU-intensive design generation
      settings: {
        stalledInterval: 90000,
        maxStalledCount: 3,
        lockDuration: 600000, // 10 minutes for large batches
      },
    }
  );

  worker.on('completed', (job, result) => {
    logger.info({ msg: 'Design worker job completed', jobId: job.id, result });
  });

  worker.on('failed', (job, err) => {
    logger.error({
      msg: 'Design worker job failed',
      jobId: job?.id,
      error: err.message,
      stack: err.stack,
    });
  });

  worker.on('error', err => {
    logger.error({ msg: 'Design worker error', error: err.message });
  });

  logger.info({ msg: 'Design worker created', queue: QUEUE_NAMES.JOBS_BACKGROUND, concurrency: 1 });
  return worker;
}

// Export preview function for API routes
export { generatePreviewCard };

export default { createDesignWorker, generatePreviewCard };
