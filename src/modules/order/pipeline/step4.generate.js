// =============================================================================
// pipeline/step4.generate.js — RESQID
// ADVANCE_RECEIVED → TOKEN_GENERATION → TOKEN_GENERATED
//
// Generates all tokens, QR PNGs, Card rows, and QrAsset rows for an order.
// This is the heaviest step in the pipeline — handles up to MAX_CARDS_PER_ORDER
// cards with controlled concurrency and chunked DB writes.
//
// SECURITY MODEL:
//   rawToken   — 64-char hex, generated in memory, NEVER stored, NEVER returned
//   tokenHash  — HMAC-SHA256(rawToken), the only thing persisted in DB
//   scanCode   — signed opaque base62 code, derived from token.id (UUID)
//   scanUrl    — https://resqid.in/s/{scanCode} — what gets encoded into QR PNG
//   card_number — printed on physical card only, never used for scan/lookup by QR
//
// CARD NUMBER ↔ TOKEN LINK:
//   Card.card_number @unique → Card.token_id → Token.id
//   When parent submits card_number, we look up Card → get token_id → load Token
//   Schema already enforces this via FK: Card.token_id → Token.id
//
// LOAD CONTROL:
//   MAX_CARDS_PER_ORDER = 1500   hard cap, validated before any work starts
//   QR_CONCURRENCY      = 10     max parallel QR PNG generations + S3 uploads
//   DB_CHUNK_SIZE       = 50     tokens inserted per chunk inside transaction
//                                prevents 1000+ concurrent Prisma creates in one tx
//
// =============================================================================

import * as repo from "../order.repository.js";
import * as tokenRepo from "../../../services/token/token.repository.js";
import {
  generateRawToken,
  hashRawToken,
  buildScanUrl,
  generateCardNumber,
  calculateExpiry,
} from "../../../services/token/token.helpers.js";
import { generateQrPng } from "../../../services/qr/qr.service.js";
import { uploadFile } from "../../../services/storage/storage.service.js";
import { writeAuditLog } from "../../../utils/helpers/auditLogger.js";
import { ApiError } from "../../../utils/response/ApiError.js";
import { logger } from "../../../config/logger.js";
import { prisma } from "../../../config/prisma.js";

// =============================================================================
// CONSTANTS
// =============================================================================

// Hard cap per order. Rationale:
//   - Typical school: 200–800 students. Large school: up to 1200.
//   - 1500 gives headroom for the largest realistic school.
//   - Beyond 1500: QR generation + S3 uploads in a single HTTP request becomes
//     unreliable (timeout risk, memory pressure). Large orders can be split.
//   - This is enforced here AND should be validated in order.validation.js at
//     order creation time so the admin knows at POST /orders, not at generate.
const MAX_CARDS_PER_ORDER = 1500;

// Max parallel QR PNG generations + S3 uploads at any point.
// At 10 concurrent: 1500 cards = 150 rounds × ~150ms avg = ~22s total.
// Raising this increases throughput but risks OOM on large orders.
const QR_CONCURRENCY = 10;

// Tokens inserted per chunk inside the Prisma transaction.
// Prevents holding 1000+ pending promises inside a single tx simultaneously,
// which saturates the connection pool.
const DB_CHUNK_SIZE = 50;

// =============================================================================
// INTERNAL HELPERS
// =============================================================================

/**
 * Run async tasks with a hard concurrency cap.
 * Processes tasks in sequential batches of `limit` — not a sliding window,
 * but good enough for our use case and simpler to reason about.
 */
const runWithConcurrency = async (tasks, limit) => {
  const results = [];
  for (let i = 0; i < tasks.length; i += limit) {
    const chunk = tasks.slice(i, i + limit);
    const chunkResults = await Promise.all(chunk.map((fn) => fn()));
    results.push(...chunkResults);
  }
  return results;
};

/**
 * Generate a collision-safe card number for a school.
 * generateCardNumber(schoolCode) already builds the full formatted string —
 * "RESQID-{SCHOOLCODE}-{6 hex chars}". No wrapping needed.
 * Collision probability: 1 in 16.7M per school. Retry cap: 5.
 */
const safeCardNumber = async (schoolCode) => {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const cardNumber = generateCardNumber(schoolCode);
    const exists = await tokenRepo.cardNumberExists(cardNumber);
    if (!exists) return cardNumber;
    logger.warn(
      `[step4] Card number collision (attempt ${attempt}): ${cardNumber}`,
    );
  }
  throw ApiError.internal(
    "Card number collision limit exceeded — this should never happen in production",
  );
};

/**
 * Bulk-insert tokens in chunks to avoid saturating the DB connection pool
 * inside a single transaction. Returns all created token rows in order.
 */
const bulkInsertTokens = async ({
  schoolId,
  orderId,
  batchId,
  isPreDetails,
  tokenData, // [{ tokenHash, expiresAt, studentId?, orderItemId? }]
}) => {
  const allCreated = [];

  for (let i = 0; i < tokenData.length; i += DB_CHUNK_SIZE) {
    const chunk = tokenData.slice(i, i + DB_CHUNK_SIZE);

    const created = await prisma.$transaction(
      chunk.map(({ tokenHash, expiresAt, studentId, orderItemId }) =>
        prisma.token.create({
          data: {
            school_id: schoolId,
            batch_id: batchId,
            order_id: orderId,
            order_item_id: orderItemId ?? null,
            student_id: studentId ?? null,
            token_hash: tokenHash,
            // Tokens stay UNASSIGNED until delivery (step8 marks them ISSUED)
            // even for PRE_DETAILS — student link is set but status is UNASSIGNED
            // until physical card reaches school.
            status: "UNASSIGNED",
            expires_at: expiresAt,
          },
          select: { id: true, order_item_id: true }, // minimal select — we only need id
        }),
      ),
    );

    allCreated.push(...created);
  }

  return allCreated;
};

// =============================================================================
// MAIN STEP
// =============================================================================

/**
 * Generate all tokens, QR PNGs, Card rows, and QrAsset rows for an order.
 *
 * @param {object} params
 * @param {string} params.orderId
 * @param {string} params.adminId
 * @param {string|null} params.note
 * @param {string} params.ip
 *
 * @returns {{
 *   batchId: string,
 *   tokenCount: number,
 *   failedCount: number,
 *   tokens: Array<{ tokenId, tokenHash, cardNumber, scanUrl, qrUrl }>
 * }}
 *
 * NOTE: rawToken is generated and immediately discarded after hashing.
 * It is never stored, never logged, never returned. tokenHash is returned
 * instead — it is safe to store/log (one-way HMAC, cannot reverse to rawToken).
 */
export const generateTokensStep = async ({ orderId, adminId, note, ip }) => {
  // ── 1. Fetch full order ──────────────────────────────────────────────────────
  const order = await repo.findOrderById(orderId);
  if (!order) throw ApiError.notFound("Order not found");
  if (!order.school) throw ApiError.internal("Order has no linked school");

  // ── 2. Guard: status ─────────────────────────────────────────────────────────
  if (order.status !== "ADVANCE_RECEIVED") {
    throw ApiError.badRequest(
      `Cannot generate tokens for order in status: ${order.status}. Expected: ADVANCE_RECEIVED`,
    );
  }

  const school = order.school;
  const cardCount = order.card_count;
  const isPreDetails = order.order_type === "PRE_DETAILS";

  // ── 3. Guard: hard cap ───────────────────────────────────────────────────────
  // Checked again here even if validation catches it at order creation,
  // because order type / count could theoretically be adjusted before this step.
  if (cardCount > MAX_CARDS_PER_ORDER) {
    throw ApiError.badRequest(
      `Order card_count (${cardCount}) exceeds maximum allowed per order (${MAX_CARDS_PER_ORDER}). ` +
        `Split into multiple orders.`,
    );
  }

  if (cardCount <= 0) {
    throw ApiError.badRequest("Order card_count must be at least 1");
  }

  // ── 4. Guard: PRE_DETAILS items ──────────────────────────────────────────────
  if (isPreDetails) {
    if (!order.items || order.items.length === 0) {
      throw ApiError.badRequest(
        "PRE_DETAILS order has no items — upload student list before generating",
      );
    }
    if (order.items.length !== cardCount) {
      throw ApiError.badRequest(
        `card_count (${cardCount}) does not match items count (${order.items.length})`,
      );
    }
  }

  const validityMonths = school.settings?.token_validity_months ?? 12;
  const qrType = isPreDetails ? "PRE_DETAILS" : "BLANK";

  // ── 5. Mark TOKEN_GENERATION ─────────────────────────────────────────────────
  await repo.setTokenGenerating({ orderId, adminId });
  await repo.writeStatusLog({
    orderId,
    fromStatus: "ADVANCE_RECEIVED",
    toStatus: "TOKEN_GENERATION",
    changedBy: adminId,
    note: note ?? `Generating ${cardCount} tokens`,
    metadata: { card_count: cardCount, order_type: order.order_type },
  });

  logger.info(
    `[step4] START orderId=${orderId} school=${school.code} count=${cardCount} type=${order.order_type}`,
  );

  // ── 6. Generate raw tokens + hashes in memory ────────────────────────────────
  // rawToken is generated and used only to produce tokenHash.
  // It is never stored anywhere — not in DB, not in logs, not in return value.
  // tokenHash = HMAC-SHA256(rawToken, TOKEN_HASH_SECRET) — one-way, safe to store.
  const tokenPairs = Array.from({ length: cardCount }, (_, i) => {
    const rawToken = generateRawToken(); // 64-char hex — lives only in this scope
    const tokenHash = hashRawToken(rawToken); // what goes to DB
    const expiresAt = calculateExpiry(validityMonths);
    return {
      tokenHash,
      expiresAt,
      // PRE_DETAILS: attach student + item linkage
      studentId: isPreDetails ? (order.items[i].student_id ?? null) : null,
      orderItemId: isPreDetails ? order.items[i].id : null,
      // rawToken referenced here briefly, then GC'd when this array goes out of scope
      // after the DB insert — never assigned to any persistent variable
    };
    // rawToken is intentionally NOT included in this object
  });

  // ── 7. Create TokenBatch header row ─────────────────────────────────────────
  const batch = await prisma.tokenBatch.create({
    data: {
      school_id: school.id,
      order_id: orderId,
      count: cardCount,
      created_by: adminId,
      status: "PENDING",
      notes: note ?? `Order ${order.order_number}`,
    },
  });

  logger.info(`[step4] TokenBatch created: ${batch.id}`);

  // ── 8. Bulk insert Token rows (chunked) ──────────────────────────────────────
  // Returns minimal rows: [{ id, order_item_id }]
  // Insertion is done in DB_CHUNK_SIZE chunks to avoid pool saturation.
  const createdTokens = await bulkInsertTokens({
    schoolId: school.id,
    orderId,
    batchId: batch.id,
    isPreDetails,
    tokenData: tokenPairs,
  });

  logger.info(`[step4] ${createdTokens.length} Token rows inserted`);

  // ── 9. Per-token: scan URL + card number + QR PNG + S3 upload ───────────────
  // Each task is a closure — processed with capped concurrency (QR_CONCURRENCY).
  // Within each task:
  //   a. buildScanUrl(token.id) → internally calls generateScanCode → opaque URL
  //   b. generateCardNumber(school.code) → "RESQID-{CODE}-{6hex}" with collision check
  //   c. generateQrPng(scanUrl) → PNG buffer (~20KB)
  //   d. uploadFile(key, buffer) → S3/stub → returns public CDN URL
  //
  // Failures are caught per-token — one bad QR does not abort the whole order.
  const qrTasks = createdTokens.map((token, i) => async () => {
    const scanUrl = buildScanUrl(token.id);

    try {
      // Card number — collision-safe, includes school prefix
      const cardNumber = await safeCardNumber(school.code);

      // QR PNG generation
      const pngBuffer = await generateQrPng(scanUrl);

      // S3 upload — key is deterministic: qr/{schoolId}/{tokenId}.png
      const storageKey = `qr/${school.id}/${token.id}.png`;
      const publicUrl = await uploadFile({
        key: storageKey,
        body: pngBuffer,
        contentType: "image/png",
      });

      return {
        token,
        cardNumber,
        scanUrl,
        storageKey,
        publicUrl,
        orderItem: isPreDetails ? order.items[i] : null,
        error: null,
      };
    } catch (err) {
      logger.error(
        `[step4] QR/upload failed for token ${token.id}: ${err.message}`,
      );
      return { token, error: err.message };
    }
  });

  const qrResults = await runWithConcurrency(qrTasks, QR_CONCURRENCY);

  // ── 10. Insert Card + QrAsset rows, collect output ──────────────────────────
  const successOutputs = [];
  const failedTokenIds = [];

  for (const result of qrResults) {
    if (result.error) {
      failedTokenIds.push(result.token.id);
      continue;
    }

    const { token, cardNumber, scanUrl, storageKey, publicUrl, orderItem } =
      result;

    // Atomic Card + QrAsset per token
    await prisma.$transaction([
      prisma.card.create({
        data: {
          school_id: school.id,
          student_id: orderItem?.student_id ?? null,
          token_id: token.id,
          order_id: orderId,
          card_number: cardNumber,
          file_url: null, // populated by step5 (card design)
          print_status: "PENDING",
        },
      }),
      prisma.qrAsset.create({
        data: {
          token_id: token.id,
          school_id: school.id,
          storage_key: storageKey,
          public_url: publicUrl,
          format: "PNG",
          qr_type: qrType,
          generated_by: adminId,
          order_id: orderId,
          is_active: true,
        },
      }),
    ]);

    // Update CardOrderItem for PRE_DETAILS orders
    if (isPreDetails && orderItem) {
      await tokenRepo.updateOrderItemTokenAssigned({
        orderItemId: orderItem.id,
        tokenId: token.id,
      });
    }

    // Collect safe output — tokenHash is safe to return (one-way HMAC)
    // rawToken is NOT included here — it was discarded after hashing in step 6
    successOutputs.push({
      tokenId: token.id,
      tokenHash: tokenPairs[qrResults.indexOf(result)].tokenHash,
      cardNumber,
      scanUrl,
      qrUrl: publicUrl,
    });
  }

  // ── 11. Finalize TokenBatch ──────────────────────────────────────────────────
  await tokenRepo.finalizeBatch({
    batchId: batch.id,
    generatedCount: successOutputs.length,
    failedCount: failedTokenIds.length,
    errorLog: failedTokenIds.length > 0 ? { failed: failedTokenIds } : null,
  });

  // ── 12. Guard: total failure ─────────────────────────────────────────────────
  // Partial failure is acceptable — admin can see which tokens failed in the batch.
  // Total failure means storage/QR service is down — throw so admin knows to retry.
  if (successOutputs.length === 0) {
    throw ApiError.internal(
      `Token generation failed — all ${cardCount} QR jobs errored. ` +
        `Check storage service and retry.`,
    );
  }

  // ── 13. Mark TOKEN_GENERATED ─────────────────────────────────────────────────
  await repo.setTokenGenerated({ orderId, adminId });
  await repo.writeStatusLog({
    orderId,
    fromStatus: "TOKEN_GENERATION",
    toStatus: "TOKEN_GENERATED",
    changedBy: adminId,
    note:
      failedTokenIds.length > 0
        ? `${successOutputs.length} tokens generated, ${failedTokenIds.length} failed`
        : `${successOutputs.length} tokens generated`,
    metadata: {
      batch_id: batch.id,
      generated_count: successOutputs.length,
      failed_count: failedTokenIds.length,
      failed_token_ids: failedTokenIds.length > 0 ? failedTokenIds : undefined,
    },
  });

  // ── 14. Audit (fire-and-forget) ──────────────────────────────────────────────
  writeAuditLog({
    actorId: adminId,
    actorType: "SUPER_ADMIN",
    schoolId: school.id,
    action: "TOKENS_GENERATED",
    entity: "CardOrder",
    entityId: orderId,
    newValue: {
      batch_id: batch.id,
      generated_count: successOutputs.length,
      failed_count: failedTokenIds.length,
    },
    ip,
  }).catch(() => {});

  logger.info(
    `[step4] DONE orderId=${orderId} generated=${successOutputs.length} failed=${failedTokenIds.length}`,
  );

  // ── 15. Return ───────────────────────────────────────────────────────────────
  // rawToken is NOT in this return — it was discarded after hashing.
  // tokenHash is safe: one-way HMAC-SHA256, cannot reverse to rawToken.
  // The controller can pass tokens[] to a CSV export or secure internal channel.
  return {
    batchId: batch.id,
    tokenCount: successOutputs.length,
    failedCount: failedTokenIds.length,
    tokens: successOutputs,
    // [ { tokenId, tokenHash, cardNumber, scanUrl, qrUrl } ]
  };
};
