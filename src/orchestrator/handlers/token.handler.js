// =============================================================================
// orchestrator/handlers/token.handler.js — RESQID
// Token generation + card number + QR generation + S3 upload.
// Processes ORDER_TOKEN_GENERATION_STARTED jobs from jobs:background queue.
// Uses crypto throughout — no sequential per-token awaits.
// PARALLEL batch processing: 20 tokens at a time.
// =============================================================================

import crypto from 'crypto';
import { prisma } from '#config/prisma.js';
import { logger } from '#config/logger.js';
import { applyTransition } from '../state/order.guards.js';
import { ORDER_STATUS } from '../state/order.states.js';
import { redis } from '#config/redis.js';

// Import authoritative helpers — no duplicates
import {
  generateRawToken,
  hashRawToken,
  generateCardNumber,
  batchGenerateCardNumbers,
  buildScanUrl,
  calculateExpiry,
  resolveBranding,
  toQrTypeEnum,
} from '#services/token/token.helpers.js';

import { generateQrPng } from '#services/qr/qr.service.js';
import { uploadFile } from '#infrastructure/storage/storage.service.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const BATCH_SIZE = 20; // parallel tokens per chunk
const PROGRESS_LOG_EVERY = 50; // log progress every N tokens

// ── Idempotency ───────────────────────────────────────────────────────────────

const idemKey = orderId => `orch:idem:token_gen:${orderId}`;
const IDEM_TTL = 86400; // 24 hours

// ── Core single-token generator (pure crypto, no sequential waits) ────────────

/**
 * Generate one token + card number + QR PNG + upload to S3.
 * All crypto operations are performed with Node's built-in crypto module.
 *
 * @returns {Promise<{ tokenId, rawToken, tokenHash, cardNumber, scanUrl, qrUrl, storageKey }>}
 */
const generateOneToken = async ({ schoolId, orderId, batchId, orderType, item, cardNumber }) => {
  // 1. Crypto: raw token (256-bit random) + HMAC-SHA256 hash
  const rawToken = generateRawToken(); // crypto.randomBytes(32).toString('hex').toUpperCase()
  const tokenHash = hashRawToken(rawToken); // HMAC-SHA256 with TOKEN_HASH_SECRET

  // 2. Create token DB record
  const tokenData = {
    school_id: schoolId,
    order_id: orderId,
    token_hash: tokenHash,
    status: 'UNASSIGNED',
    batch_id: batchId,
  };

  // PRE_DETAILS: link to student immediately
  if (orderType === 'PRE_DETAILS' && item) {
    tokenData.order_item_id = item.id;
    tokenData.student_id = item.student_id;
  }

  const token = await prisma.token.create({ data: tokenData });

  // 3. Crypto: AES-SIV scan code → deterministic scan URL
  const scanUrl = buildScanUrl(token.id); // generateScanCode(tokenId) under the hood

  // 4. Generate QR PNG buffer (no external CDN — pure Node/Canvas)
  const qrBuffer = await generateQrPng(scanUrl);

  // 5. Upload QR PNG to S3/R2
  const storageKey = `qr/${schoolId}/${orderId}/${token.id}.png`;
  const qrUrl = await uploadFile({
    key: storageKey,
    body: qrBuffer,
    contentType: 'image/png',
    cacheControl: 'public, max-age=31536000',
  });

  // 6. Write Card + QrAsset atomically (single transaction — orphan-proof)
  await prisma.$transaction([
    prisma.card.create({
      data: {
        school_id: schoolId,
        token_id: token.id,
        order_id: orderId,
        card_number: cardNumber,
        print_status: 'PENDING',
        // file_url intentionally null here — set by design.handler.js
      },
    }),
    prisma.qrAsset.create({
      data: {
        token_id: token.id,
        school_id: schoolId,
        storage_key: storageKey,
        public_url: qrUrl,
        format: 'PNG',
        width_px: 512,
        height_px: 512,
        qr_type: toQrTypeEnum(orderType),
        generated_by: 'SYSTEM',
        order_id: orderId,
        is_active: true,
      },
    }),
  ]);

  // 7. If PRE_DETAILS — link token back to order item
  if (orderType === 'PRE_DETAILS' && item) {
    await prisma.cardOrderItem.update({
      where: { id: item.id },
      data: { token_id: token.id },
    });
  }

  return { tokenId: token.id, rawToken, tokenHash, cardNumber, scanUrl, qrUrl, storageKey };
};

// ── Main handler ──────────────────────────────────────────────────────────────

/**
 * Process an ORDER_TOKEN_GENERATION_STARTED job.
 * Generates all tokens, QRs, and card records for an order.
 * Parallel chunks of BATCH_SIZE = 20 — no sequential per-token awaits.
 *
 * @param {import('bullmq').Job} job
 * @returns {Promise<{ success: boolean, data: object }>}
 */
export const handleTokenGeneration = async job => {
  const {
    orderId,
    schoolId,
    batchId,
    orderType,
    cardCount,
    items = [], // CardOrderItems for PRE_DETAILS
    actorId,
  } = job.data?.payload ?? {};

  if (!orderId || !schoolId || !batchId || !cardCount) {
    throw new Error(
      '[token.handler] Missing required fields: orderId, schoolId, batchId, cardCount'
    );
  }

  // ── Idempotency check ──────────────────────────────────────────────────────
  const idem = await redis.get(idemKey(orderId));
  if (idem) {
    logger.info(
      { jobId: job.id, orderId },
      '[token.handler] Already processed — skipping (idempotent)'
    );
    return { success: true, data: { skipped: true, orderId } };
  }

  logger.info(
    { jobId: job.id, orderId, schoolId, cardCount, orderType },
    '[token.handler] Starting token generation'
  );

  // ── Load school for branding + serial number ───────────────────────────────
  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: {
      id: true,
      serial_number: true,
      settings: { select: { token_validity_months: true } },
      subscriptions: {
        orderBy: { created_at: 'desc' },
        take: 1,
        select: { plan: true, status: true },
      },
    },
  });

  if (!school) throw new Error(`[token.handler] School not found: ${schoolId}`);

  const validityMonths = school.settings?.token_validity_months ?? 12;
  const expiresAt = calculateExpiry(validityMonths);

  // ── Pre-generate all card numbers (crypto-random, collision-safe) ──────────
  const cardNumbers = batchGenerateCardNumbers(school.serial_number, cardCount);

  // ── Check for collisions and regenerate any that clash ────────────────────
  const uniqueCardNumbers = [];
  for (const cn of cardNumbers) {
    const exists = await prisma.card.findUnique({
      where: { card_number: cn },
      select: { id: true },
    });
    if (exists) {
      // Collision — generate a fresh one (astronomically rare: 16.7M combinations)
      let fresh;
      do {
        const hex = crypto.randomBytes(4).toString('hex').toUpperCase();
        const serial = String(school.serial_number).padStart(4, '0');
        fresh = `RQ-${serial}-${hex}`;
      } while (
        await prisma.card.findUnique({ where: { card_number: fresh }, select: { id: true } })
      );
      uniqueCardNumbers.push(fresh);
    } else {
      uniqueCardNumbers.push(cn);
    }
  }

  // ── Parallel chunk processing ──────────────────────────────────────────────
  const results = [];
  const errors = [];

  for (let i = 0; i < cardCount; i += BATCH_SIZE) {
    const chunkEnd = Math.min(i + BATCH_SIZE, cardCount);
    const chunkItems = Array.from({ length: chunkEnd - i }, (_, k) => ({
      index: i + k,
      cardNumber: uniqueCardNumbers[i + k],
      item: items[i + k] ?? null,
    }));

    const chunkResults = await Promise.allSettled(
      chunkItems.map(({ cardNumber, item }) =>
        generateOneToken({ schoolId, orderId, batchId, orderType, item, cardNumber })
      )
    );

    for (let j = 0; j < chunkResults.length; j++) {
      const r = chunkResults[j];
      if (r.status === 'fulfilled') {
        results.push(r.value);
      } else {
        const failedItem = chunkItems[j];
        errors.push({ index: failedItem.index, error: r.reason?.message ?? 'Unknown' });
        logger.error(
          { err: r.reason?.message, orderId, index: failedItem.index },
          '[token.handler] Token generation failed for item'
        );
      }
    }

    // Progress log
    if ((i + BATCH_SIZE) % PROGRESS_LOG_EVERY === 0 || i + BATCH_SIZE >= cardCount) {
      logger.info(
        { orderId, generated: results.length, failed: errors.length, total: cardCount },
        `[token.handler] Progress: ${results.length}/${cardCount}`
      );
    }
  }

  // ── Finalize TokenBatch ────────────────────────────────────────────────────
  const batchStatus =
    results.length === 0
      ? 'FAILED'
      : errors.length > 0
        ? 'PARTIAL'
        : /* all succeeded */ 'COMPLETE';

  await prisma.tokenBatch.update({
    where: { id: batchId },
    data: {
      status: batchStatus,
      generated_count: results.length,
      failed_count: errors.length,
      completed_at: new Date(),
      error_log: errors.length ? errors : null,
    },
  });

  if (results.length === 0) {
    throw new Error(`[token.handler] All ${cardCount} tokens failed — order ${orderId}`);
  }

  // ── Set idempotency key ────────────────────────────────────────────────────
  await redis.setex(idemKey(orderId), IDEM_TTL, '1');

  // ── Transition order state to TOKEN_GENERATED ──────────────────────────────
  const order = await prisma.cardOrder.findUnique({
    where: { id: orderId },
    select: { status: true, order_number: true },
  });

  await applyTransition({
    orderId,
    from: order.status,
    to: ORDER_STATUS.TOKEN_GENERATED,
    actorId: actorId ?? 'SYSTEM',
    actorType: 'WORKER',
    schoolId,
    meta: { generated: results.length, failed: errors.length },
    eventPayload: { orderNumber: order.order_number, tokenCount: results.length },
  });

  logger.info(
    { jobId: job.id, orderId, generated: results.length, failed: errors.length },
    '[token.handler] Token generation complete'
  );

  return {
    success: true,
    data: {
      orderId,
      generated: results.length,
      failed: errors.length,
      batchStatus,
      newStatus: ORDER_STATUS.TOKEN_GENERATED,
    },
  };
};
