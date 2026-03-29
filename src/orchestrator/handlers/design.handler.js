// =============================================================================
// orchestrator/handlers/design.handler.js — RESQID
// Card design: load template → merge student data with sharp → PDF → S3.
// Two templates only: BLANK and PRE_DETAILS (300 DPI, print-ready).
// =============================================================================

import crypto from 'crypto';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { prisma } from '#config/prisma.js';
import { logger } from '#config/logger.js';
import { uploadFile } from '#infrastructure/storage/storage.service.js';
import { applyTransition } from '../state/order.guards.js';
import { ORDER_STATUS } from '../state/order.states.js';
import { redis } from '#config/redis.js';
import { resolveBranding } from '#services/token/token.helpers.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const CARD_WIDTH_PX = 1011; // CR80 card at 300 DPI (3.375 in × 300)
const CARD_HEIGHT_PX = 638; // CR80 card at 300 DPI (2.125 in × 300)
const BATCH_SIZE = 10; // compose N cards in parallel

const idemKey = orderId => `orch:idem:card_design:${orderId}`;
const IDEM_TTL = 86400;

// ── Template loader ───────────────────────────────────────────────────────────

/**
 * Load CardTemplate config from DB (zones stored as JSON).
 * Falls back to built-in defaults if no DB record for this order's template.
 */
const loadTemplate = async templateId => {
  if (!templateId) return getDefaultTemplate('BLANK');

  const tmpl = await prisma.cardTemplate.findUnique({
    where: { id: templateId },
    select: { id: true, type: true, zones: true, background_url: true },
  });

  return tmpl ?? getDefaultTemplate('BLANK');
};

const getDefaultTemplate = type => ({
  type,
  background_url: null,
  zones:
    type === 'BLANK'
      ? {
          qr: { x: 820, y: 219, size: 200 },
          cardNumber: { x: 60, y: 580, fontSize: 22 },
          schoolName: { x: 60, y: 60, fontSize: 28 },
        }
      : {
          qr: { x: 820, y: 219, size: 200 },
          photo: { x: 60, y: 180, width: 150, height: 180 },
          name: { x: 240, y: 200, fontSize: 28 },
          classSection: { x: 240, y: 250, fontSize: 22 },
          bloodGroup: { x: 240, y: 300, fontSize: 22 },
          cardNumber: { x: 60, y: 580, fontSize: 22 },
          schoolName: { x: 60, y: 60, fontSize: 28 },
        },
});

// ── Fetch student data for card ───────────────────────────────────────────────

const loadStudentsWithProfiles = async studentIds => {
  const [students, profiles] = await Promise.all([
    prisma.student.findMany({
      where: { id: { in: studentIds } },
      select: {
        id: true,
        first_name: true,
        last_name: true,
        photo_url: true,
        class: true,
        section: true,
      },
    }),
    prisma.emergencyProfile.findMany({
      where: { student_id: { in: studentIds } },
      select: { student_id: true, blood_group: true },
    }),
  ]);

  const profileMap = new Map(profiles.map(p => [p.student_id, p]));
  return students.map(s => ({ ...s, emergency: profileMap.get(s.id) ?? null }));
};

// ── Single card compositor ─────────────────────────────────────────────────────

/**
 * Compose one card image as a PNG buffer using sharp.
 * BLANK template: QR + card number + school name.
 * PRE_DETAILS template: above + student photo + name + class + blood group.
 */
const composeCard = async ({ student, qrUrl, cardNumber, schoolName, branding, template }) => {
  const zones = template.zones;

  // Start with white base (300 DPI CR80)
  let base = sharp({
    create: { width: CARD_WIDTH_PX, height: CARD_HEIGHT_PX, channels: 3, background: '#FFFFFF' },
  }).png();

  const composites = [];

  // Fetch QR image from S3
  try {
    const qrRes = await fetch(qrUrl, { signal: AbortSignal.timeout(8000) });
    const qrBuf = Buffer.from(await qrRes.arrayBuffer());
    const qrSize = zones.qr?.size ?? 200;
    const qrResized = await sharp(qrBuf).resize(qrSize, qrSize).png().toBuffer();
    composites.push({ input: qrResized, top: zones.qr?.y ?? 219, left: zones.qr?.x ?? 820 });
  } catch (err) {
    logger.warn({ err: err.message, cardNumber }, '[design.handler] Failed to fetch QR image');
  }

  // School logo (paid plans only)
  if (branding.logoUrl) {
    try {
      const logoRes = await fetch(branding.logoUrl, { signal: AbortSignal.timeout(8000) });
      const logoBuf = Buffer.from(await logoRes.arrayBuffer());
      const logoSmall = await sharp(logoBuf).resize(120, 60, { fit: 'inside' }).png().toBuffer();
      composites.push({ input: logoSmall, top: 20, left: CARD_WIDTH_PX - 140 });
    } catch (err) {
      logger.warn({ err: err.message }, '[design.handler] Failed to fetch school logo');
    }
  }

  // PRE_DETAILS: student photo
  if (template.type === 'PRE_DETAILS' && student?.photo_url && zones.photo) {
    try {
      const photoRes = await fetch(student.photo_url, { signal: AbortSignal.timeout(8000) });
      const photoBuf = Buffer.from(await photoRes.arrayBuffer());
      const photoResized = await sharp(photoBuf)
        .resize(zones.photo.width ?? 150, zones.photo.height ?? 180, { fit: 'cover' })
        .png()
        .toBuffer();
      composites.push({
        input: photoResized,
        top: zones.photo.y ?? 180,
        left: zones.photo.x ?? 60,
      });
    } catch (err) {
      logger.warn(
        { err: err.message, studentId: student.id },
        '[design.handler] Failed to fetch student photo'
      );
    }
  }

  // SVG text overlay (school name, student name, class, blood group, card number)
  const textLines = [];

  if (zones.schoolName && schoolName) {
    textLines.push(
      `<text x="${zones.schoolName.x}" y="${zones.schoolName.y}" font-size="${zones.schoolName.fontSize ?? 28}" font-family="Arial" font-weight="bold" fill="#1a1a1a">${escapeXml(schoolName)}</text>`
    );
  }

  if (template.type === 'PRE_DETAILS' && student) {
    const fullName = `${student.first_name ?? ''} ${student.last_name ?? ''}`.trim();
    const classStr = [student.class, student.section].filter(Boolean).join(' - ');
    const bloodGroup =
      student.emergency?.blood_group?.replace('_POS', '+').replace('_NEG', '-') ?? '';

    if (zones.name)
      textLines.push(
        `<text x="${zones.name.x}" y="${zones.name.y}" font-size="${zones.name.fontSize ?? 28}" font-family="Arial" font-weight="bold" fill="#1a1a1a">${escapeXml(fullName)}</text>`
      );
    if (zones.classSection && classStr)
      textLines.push(
        `<text x="${zones.classSection.x}" y="${zones.classSection.y}" font-size="${zones.classSection.fontSize ?? 22}" font-family="Arial" fill="#333">${escapeXml(classStr)}</text>`
      );
    if (zones.bloodGroup && bloodGroup)
      textLines.push(
        `<text x="${zones.bloodGroup.x}" y="${zones.bloodGroup.y}" font-size="${zones.bloodGroup.fontSize ?? 22}" font-family="Arial" fill="#c0392b">${escapeXml(bloodGroup)}</text>`
      );
  }

  if (zones.cardNumber && cardNumber) {
    textLines.push(
      `<text x="${zones.cardNumber.x}" y="${zones.cardNumber.y}" font-size="${zones.cardNumber.fontSize ?? 22}" font-family="Courier New" fill="#555">${escapeXml(cardNumber)}</text>`
    );
  }

  if (textLines.length > 0) {
    const svg = `<svg width="${CARD_WIDTH_PX}" height="${CARD_HEIGHT_PX}" xmlns="http://www.w3.org/2000/svg">${textLines.join('')}</svg>`;
    composites.push({ input: Buffer.from(svg), top: 0, left: 0 });
  }

  const cardBuffer = await sharp({
    create: { width: CARD_WIDTH_PX, height: CARD_HEIGHT_PX, channels: 3, background: '#FFFFFF' },
  })
    .composite(composites)
    .png({ compressionLevel: 6 })
    .toBuffer();

  return cardBuffer;
};

const escapeXml = str =>
  String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// ── PDF assembler ─────────────────────────────────────────────────────────────

/**
 * Assemble all card PNGs into a single print-ready PDF (300 DPI, one card per page).
 */
const assembleCardPdf = async cardBuffers => {
  const pdfDoc = await PDFDocument.create();

  for (const buf of cardBuffers) {
    const img = await pdfDoc.embedPng(buf);
    const page = pdfDoc.addPage([CARD_WIDTH_PX * 0.24, CARD_HEIGHT_PX * 0.24]); // pts ≈ 72dpi/300dpi
    page.drawImage(img, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
  }

  return Buffer.from(await pdfDoc.save());
};

// ── Main handler ──────────────────────────────────────────────────────────────

/**
 * Process an ORDER_CARD_DESIGN_STARTED job.
 * Composes all cards, generates print-ready PDF, uploads to S3/R2.
 *
 * @param {import('bullmq').Job} job
 * @returns {Promise<{ success: boolean, data: object }>}
 */
export const handleCardDesign = async job => {
  const { orderId, schoolId, templateId, actorId } = job.data?.payload ?? {};

  if (!orderId || !schoolId) {
    throw new Error('[design.handler] Missing required fields: orderId, schoolId');
  }

  // ── Idempotency ──────────────────────────────────────────────────────────
  const idem = await redis.get(idemKey(orderId));
  if (idem) {
    logger.info(
      { jobId: job.id, orderId },
      '[design.handler] Already processed — skipping (idempotent)'
    );
    return { success: true, data: { skipped: true, orderId } };
  }

  logger.info({ jobId: job.id, orderId, schoolId }, '[design.handler] Starting card design');

  // ── Load order + cards + tokens ──────────────────────────────────────────
  const order = await prisma.cardOrder.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      status: true,
      order_type: true,
      order_number: true,
      school: {
        select: {
          id: true,
          name: true,
          logo_url: true,
          serial_number: true,
          subscriptions: { orderBy: { created_at: 'desc' }, take: 1, select: { plan: true } },
        },
      },
      cards: {
        select: {
          id: true,
          card_number: true,
          token: { select: { id: true } },
          qrAssets: { where: { is_active: true }, select: { public_url: true } },
          orderItem: { select: { student_id: true } },
        },
      },
    },
  });

  if (!order) throw new Error(`[design.handler] Order not found: ${orderId}`);

  const template = await loadTemplate(templateId);
  const branding = resolveBranding(order.school);
  const schoolName = order.school.name;

  // ── Load student data (PRE_DETAILS only) ──────────────────────────────────
  let studentMap = new Map();
  if (order.order_type === 'PRE_DETAILS') {
    const studentIds = order.cards.map(c => c.orderItem?.student_id).filter(Boolean);

    if (studentIds.length > 0) {
      const students = await loadStudentsWithProfiles(studentIds);
      studentMap = new Map(students.map(s => [s.id, s]));
    }
  }

  // ── Compose cards in parallel chunks ──────────────────────────────────────
  const cardBuffers = [];
  const failedCards = [];

  for (let i = 0; i < order.cards.length; i += BATCH_SIZE) {
    const chunk = order.cards.slice(i, i + BATCH_SIZE);

    const chunkResults = await Promise.allSettled(
      chunk.map(card => {
        const qrUrl = card.qrAssets?.[0]?.public_url ?? null;
        const studentId = card.orderItem?.student_id ?? null;
        const student = studentId ? studentMap.get(studentId) : null;

        return composeCard({
          student,
          qrUrl,
          cardNumber: card.card_number,
          schoolName,
          branding,
          template,
        });
      })
    );

    for (let j = 0; j < chunkResults.length; j++) {
      const r = chunkResults[j];
      if (r.status === 'fulfilled') {
        cardBuffers.push(r.value);
      } else {
        failedCards.push({ cardId: chunk[j].id, error: r.reason?.message });
        logger.error(
          { err: r.reason?.message, cardId: chunk[j].id, orderId },
          '[design.handler] Card composition failed'
        );
      }
    }
  }

  if (cardBuffers.length === 0) {
    throw new Error(`[design.handler] All card compositions failed for order ${orderId}`);
  }

  // ── Assemble PDF ──────────────────────────────────────────────────────────
  logger.info({ orderId, cardCount: cardBuffers.length }, '[design.handler] Assembling PDF');
  const pdfBuffer = await assembleCardPdf(cardBuffers);

  // ── Upload PDF to S3/R2 ───────────────────────────────────────────────────
  const pdfStorageKey = `schools/${schoolId}/orders/${orderId}/cards-final.pdf`;
  const pdfUrl = await uploadFile({
    key: pdfStorageKey,
    body: pdfBuffer,
    contentType: 'application/pdf',
  });

  // ── Write CardDesignAsset record ──────────────────────────────────────────
  await prisma.cardDesignAsset.create({
    data: {
      order_id: orderId,
      school_id: schoolId,
      storage_key: pdfStorageKey,
      public_url: pdfUrl,
      card_count: cardBuffers.length,
      failed_count: failedCards.length,
      template_type: template.type,
    },
  });

  // ── Update CardOrder design_status ────────────────────────────────────────
  await prisma.cardOrder.update({
    where: { id: orderId },
    data: { design_status: 'COMPLETED' },
  });

  // ── Set idempotency key ───────────────────────────────────────────────────
  await redis.setex(idemKey(orderId), IDEM_TTL, '1');

  // ── Transition to CARD_DESIGN_READY ──────────────────────────────────────
  await applyTransition({
    orderId,
    from: order.status,
    to: ORDER_STATUS.CARD_DESIGN_READY,
    actorId: actorId ?? 'SYSTEM',
    actorType: 'WORKER',
    schoolId,
    meta: { pdfUrl, composed: cardBuffers.length, failed: failedCards.length },
    eventPayload: { orderNumber: order.order_number, pdfUrl },
  });

  logger.info(
    { jobId: job.id, orderId, composed: cardBuffers.length, failed: failedCards.length, pdfUrl },
    '[design.handler] Card design complete'
  );

  return {
    success: true,
    data: {
      orderId,
      pdfUrl,
      composed: cardBuffers.length,
      failed: failedCards.length,
      newStatus: ORDER_STATUS.CARD_DESIGN_READY,
    },
  };
};
