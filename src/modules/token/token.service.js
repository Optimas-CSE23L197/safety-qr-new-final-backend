// =============================================================================
// token.service.js — RESQID
//
// SECURITY MODEL:
//   rawToken   → generated once, shown once to super admin, NEVER stored
//   token_hash → HMAC-SHA256(rawToken, TOKEN_HASH_SECRET) → stored in DB
//   scanCode   → signed opaque code (UUID compressed + HMAC buried inside)
//   scanUrl    → https://resqid.in/s/{scanCode} → encoded in QR image
//   cardNumber → RESQID-{SCHOOLCODE}-{6hex} → printed on physical card only
//
// 4 FLOWS:
//   generateSingleBlankToken       → 1 token, no student, UNASSIGNED
//   generateBulkBlankTokens        → N tokens, no students, UNASSIGNED, batched
//   generateSinglePreloadedToken   → 1 token, 1 student, ACTIVE immediately
//   generateBulkPreloadedTokens    → N tokens, N students, ACTIVE, batched
//
// WHAT THIS SERVICE DOES:
//   Token → QR PNG → Card number → QrAsset DB row → Card DB row
//   Card.file_url is NOT set here — that belongs to card.service.js (design step)
//
// WHAT COMES AFTER (card.service.js):
//   Fetch QrAsset → compose full card design (logo + student + QR) → S3
//   → Card.file_url updated → print sheet compiled → sent to vendor
//
// FIXES APPLIED:
//   [#1] toQrTypeEnum() maps "SINGLE_BLANK" → "BLANK" before Prisma write
//   [#2] Card.file_url = null — design step fills this, not token step
//   [#3] Card numbers pre-generated sequentially, not inside Promise.all
//   [#4] createCardWithQrAsset() — Card + QrAsset atomic transaction
//   [#5] Unused (td, i) → (td) in final map
//
// AUDIT LOG:
//   Every operation writes to AuditLog — fire-and-forget, never blocks
// =============================================================================

import { logger } from "../../config/logger.js";
import * as repo from "./token.repository.js";
import { ApiError } from "../../utils/response/ApiError.js";
import {
  generateRawToken,
  hashRawToken,
  buildScanUrl,
  generateCardNumber,
  generateBlankCardNumber,
  calculateExpiry,
  resolveBranding,
  toQrTypeEnum, // FIX [#1]
} from "./token.helpers.js";

// =============================================================================
// CONSTANTS
// =============================================================================

const MAX_BULK_LIMIT = 1000;

// =============================================================================
// PRIVATE HELPERS
// =============================================================================

/**
 * Validate school exists and is active.
 * Returns school with settings + subscription.
 */
const validateSchool = async (schoolId) => {
  const school = await repo.findSchoolWithSettings(schoolId);
  if (!school) throw ApiError.notFound("School not found");
  if (!school.is_active) throw ApiError.forbidden("School account is inactive");
  return school;
};

/**
 * Validate student belongs to school.
 */
const validateStudent = async (studentId, schoolId) => {
  const student = await repo.findStudentInSchool(studentId, schoolId);
  if (!student) {
    throw ApiError.notFound(
      `Student ${studentId} not found or does not belong to this school`,
    );
  }
  return student;
};

/**
 * Check student has not exceeded token limit.
 */
const checkTokenLimit = async (studentId, maxTokens = 1) => {
  const count = await repo.countActiveTokensForStudent(studentId);
  if (count >= maxTokens) {
    throw ApiError.conflict(
      `Student already has ${count} active token(s). Revoke existing token before generating a new one.`,
    );
  }
};

/**
 * FIX [#3] — Card numbers pre-generated sequentially.
 * Previously called inside Promise.all — for 500 tokens that fires up to
 * 2,500 concurrent DB queries, exhausting the connection pool.
 * Sequential pre-generation avoids DB pressure entirely.
 * Collisions are ~1 in 16.7M — sequential retries are fast enough.
 *
 * @param {string}  schoolCode
 * @param {boolean} isBlank
 * @param {number}  count
 * @returns {Promise<string[]>}
 */
const pregenerateCardNumbers = async (schoolCode, isBlank, count) => {
  const numbers = [];
  for (let i = 0; i < count; i++) {
    // Retry up to 5 times per card number on collision
    let generated = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      const number = isBlank
        ? generateBlankCardNumber()
        : generateCardNumber(schoolCode);
      const exists = await repo.cardNumberExists(number);
      if (!exists) {
        numbers.push(number);
        generated = true;
        break;
      }
    }
    if (!generated) {
      throw new Error(
        `Failed to generate unique card number after 5 attempts (index ${i})`,
      );
    }
  }
  return numbers;
};

/**
 * Fire-and-forget audit log.
 * Never throws, never blocks the main operation.
 */
const audit = (params) => {
  repo.writeAuditLog(params).catch((err) => {
    logger.error(
      { type: "audit_log_failure", err: err.message, action: params.action },
      "Token audit log write failed — logged here as fallback",
    );
  });
};

// =============================================================================
// 1. SINGLE BLANK TOKEN
// =============================================================================

/**
 * Generate 1 blank token — no student attached.
 * Status: UNASSIGNED
 *
 * Flow:
 *   1. Validate school
 *   2. Generate rawToken + hash
 *   3. Save token to DB → get token.id
 *   4. Generate card number (collision-safe, sequential)
 *   5. Build signed scan URL using token.id
 *   6. Generate QR PNG → S3
 *   7. Save Card + QrAsset atomically (single transaction)
 *   8. Audit log (fire-and-forget)
 *   9. Return result — rawToken shown ONCE only
 *
 * @param {object} params
 * @param {string} params.schoolId
 * @param {string} params.createdBy    - SuperAdmin.id
 * @param {string} params.actorType    - "SUPER_ADMIN"
 * @param {string} [params.orderId]    - CardOrder.id if triggered from order pipeline
 * @param {object} [params.ua]         - parsed user agent
 * @param {string} [params.ipAddress]
 * @param {string} [params.notes]
 * @param {object} [params.qrService]  - injected QR generator (testable)
 * @returns {{ tokenId, rawToken, scanUrl, cardNumber, cardId, qrUrl }}
 */
export const generateSingleBlankToken = async ({
  schoolId,
  createdBy,
  actorType,
  orderId = null,
  ua = null,
  ipAddress = null,
  notes = null,
  qrService,
}) => {
  // ── 1. Validate ───────────────────────────────────────────────────────────
  const school = await validateSchool(schoolId);
  const validityMonths = school.settings?.token_validity_months ?? 12;
  const expiresAt = calculateExpiry(validityMonths);
  const branding = resolveBranding(school);

  // ── 2. Generate raw token ─────────────────────────────────────────────────
  const rawToken = generateRawToken();
  const tokenHash = hashRawToken(rawToken);

  // ── 3. Save token → get UUID ──────────────────────────────────────────────
  const token = await repo.createToken({
    schoolId,
    tokenHash,
    expiresAt,
    orderId,
  });

  // ── 4. Card number — sequential, collision-safe ───────────────────────────
  // FIX [#3] — single card, no bulk pressure issue, but use same pattern for consistency
  const [cardNumber] = await pregenerateCardNumbers(school.code, true, 1);

  // ── 5. Signed scan URL — token UUID never exposed raw in URL ─────────────
  const scanUrl = buildScanUrl(token.id);

  // ── 6. Generate QR PNG → S3 ───────────────────────────────────────────────
  const qrResult = await qrService.generateAndUpload({
    content: scanUrl,
    tokenId: token.id,
    schoolId,
    qrType: "SINGLE_BLANK", // rich internal string, kept in qrService + audit
    branding,
    generatedBy: createdBy,
  });

  // ── 7. Save Card + QrAsset — atomic transaction ───────────────────────────
  // FIX [#2] — Card.file_url is null here. This step produces a QR PNG only.
  //            Full card design (logo + student photo + QR composed) is done
  //            later by card.service.js. Card.file_url updated there.
  // FIX [#4] — Single prisma.$transaction — both or neither. No orphaned Cards.
  // FIX [#1] — toQrTypeEnum() maps "SINGLE_BLANK" → "BLANK" for Prisma enum.
  const [card] = await repo.createCardWithQrAsset({
    cardData: {
      school_id: schoolId,
      student_id: null,
      token_id: token.id,
      card_number: cardNumber,
      file_url: null, // populated by card.service.js (design step)
      print_status: "PENDING",
    },
    qrData: {
      token_id: token.id,
      school_id: schoolId,
      storage_key: qrResult.storageKey,
      public_url: qrResult.publicUrl,
      format: "PNG",
      qr_type: toQrTypeEnum("SINGLE_BLANK"), // FIX [#1] → "BLANK"
      generated_by: createdBy,
      order_id: orderId,
      is_active: true,
    },
  });

  // ── 8. Audit log — fire-and-forget ────────────────────────────────────────
  audit({
    schoolId,
    actorId: createdBy,
    actorType,
    action: "TOKEN_GENERATE",
    entity: "Token",
    entityId: token.id,
    oldValue: null,
    newValue: {
      card_type: "SINGLE_BLANK",
      status: "UNASSIGNED",
      card_number: cardNumber,
      card_id: card.id,
      order_id: orderId,
      expires_at: expiresAt,
    },
    metadata: { type: "SINGLE_BLANK", notes },
    ip: ipAddress,
  });

  // ── 9. Return — rawToken shown ONCE, then gone ────────────────────────────
  return {
    tokenId: token.id,
    rawToken, // ⚠ shown once to super admin — never log, cache, or persist
    scanUrl, // ← encoded in QR image
    cardNumber, // ← printed on physical card
    cardId: card.id,
    qrUrl: qrResult.publicUrl,
  };
};

// =============================================================================
// 2. BULK BLANK TOKENS
// =============================================================================

/**
 * Generate N blank tokens in one batch — no students.
 * All UNASSIGNED. Atomic DB transaction.
 *
 * @param {object}  params
 * @param {string}  params.schoolId
 * @param {number}  params.count
 * @param {string}  params.createdBy
 * @param {string}  params.actorType
 * @param {string}  [params.orderId]
 * @param {object}  [params.ua]
 * @param {string}  [params.ipAddress]
 * @param {string}  [params.notes]
 * @param {object}  [params.qrService]
 * @returns {{ batchId, tokens: Array<{ tokenId, rawToken, scanUrl, cardNumber, qrUrl }> }}
 */
export const generateBulkBlankTokens = async ({
  schoolId,
  count,
  createdBy,
  actorType,
  orderId = null,
  ua = null,
  ipAddress = null,
  notes = null,
  qrService,
}) => {
  // ── 1. Validate ───────────────────────────────────────────────────────────
  const school = await validateSchool(schoolId);
  const validityMonths = school.settings?.token_validity_months ?? 12;
  const expiresAt = calculateExpiry(validityMonths);
  const branding = resolveBranding(school);

  if (!Number.isInteger(count) || count < 1) {
    throw ApiError.badRequest("count must be a positive integer");
  }
  if (count > MAX_BULK_LIMIT) {
    throw ApiError.badRequest(
      `Bulk limit is ${MAX_BULK_LIMIT} per request. Received: ${count}`,
    );
  }

  // ── 2. Pre-generate all raw tokens in memory BEFORE DB ───────────────────
  // hash→rawToken map lets us recover rawToken after DB insert without re-hashing
  const rawTokenData = Array.from({ length: count }, () => {
    const rawToken = generateRawToken();
    const tokenHash = hashRawToken(rawToken);
    return { rawToken, tokenHash, expiresAt };
  });

  // ── 3. FIX [#3] — Pre-generate all card numbers sequentially BEFORE bulk map
  // Previously inside Promise.all → up to count×5 concurrent DB queries.
  // Sequential pre-generation: ~count queries total, no pool pressure.
  const cardNumbers = await pregenerateCardNumbers(school.code, true, count);

  // ── 4. Atomic DB: TokenBatch + all Tokens ─────────────────────────────────
  const { batch, createdTokens } = await repo.createBatchWithTokens({
    schoolId,
    orderId,
    count,
    createdBy,
    notes,
    tokenData: rawTokenData,
  });

  // ── 5. Build hash→rawToken map + attach scanUrl + cardNumber ──────────────
  const hashToRaw = new Map(
    rawTokenData.map(({ rawToken, tokenHash }) => [tokenHash, rawToken]),
  );

  // Pure CPU work — no DB calls inside map (card numbers already pre-generated)
  const tokenData = createdTokens.map((t, i) => {
    const rawToken = hashToRaw.get(t.token_hash);
    if (!rawToken) throw new Error(`Hash mismatch for token ${t.id}`);
    const scanUrl = buildScanUrl(t.id);
    return { tokenId: t.id, rawToken, scanUrl, cardNumber: cardNumbers[i] };
  });

  // ── 6. Generate all QR PNGs → S3 (concurrency capped inside qrService) ───
  const qrResults = await qrService.generateAndUploadBulk({
    items: tokenData.map((td) => ({
      content: td.scanUrl,
      tokenId: td.tokenId,
      schoolId,
      qrType: "BULK_BLANK",
      branding,
      generatedBy: createdBy,
    })),
  });

  const qrByTokenId = new Map(qrResults.map((r) => [r.tokenId, r]));

  // ── 7. FIX [#4] — Save Card + QrAsset atomically per token ───────────────
  // FIX [#2] — file_url: null (card design step fills this later)
  // FIX [#1] — toQrTypeEnum maps to Prisma enum value
  await Promise.all(
    tokenData.map((td) => {
      const qr = qrByTokenId.get(td.tokenId);
      return repo.createCardWithQrAsset({
        cardData: {
          school_id: schoolId,
          student_id: null,
          token_id: td.tokenId,
          card_number: td.cardNumber,
          file_url: null, // card.service.js fills this during design step
          print_status: "PENDING",
        },
        qrData: {
          token_id: td.tokenId,
          school_id: schoolId,
          storage_key: qr.storageKey,
          public_url: qr.publicUrl,
          format: "PNG",
          qr_type: toQrTypeEnum("BULK_BLANK"), // FIX [#1] → "BLANK"
          generated_by: createdBy,
          order_id: orderId,
          is_active: true,
        },
      });
    }),
  );

  // ── 8. Audit log — fire-and-forget ────────────────────────────────────────
  audit({
    schoolId,
    actorId: createdBy,
    actorType,
    action: "TOKEN_GENERATE",
    entity: "TokenBatch",
    entityId: batch.id,
    oldValue: null,
    newValue: {
      card_type: "BULK_BLANK",
      count,
      order_id: orderId,
      status: "UNASSIGNED",
      expires_at: expiresAt,
    },
    metadata: { type: "BULK_BLANK", notes },
    ip: ipAddress,
  });

  // ── 9. Return ─────────────────────────────────────────────────────────────
  // ⚠ rawToken array shown ONCE — never log, cache, or persist this response
  const tokens = tokenData.map((td) => ({
    // FIX [#5] — removed unused (td, i)
    tokenId: td.tokenId,
    rawToken: td.rawToken,
    scanUrl: td.scanUrl,
    cardNumber: td.cardNumber,
    qrUrl: qrByTokenId.get(td.tokenId)?.publicUrl ?? null,
  }));

  return { batchId: batch.id, tokens };
};

// =============================================================================
// 3. SINGLE PRE-DETAILS TOKEN
// =============================================================================

/**
 * Generate 1 token pre-linked to a student.
 * Status: ACTIVE immediately — student info will be printed on card.
 *
 * @param {object} params
 * @param {string} params.schoolId
 * @param {string} params.studentId
 * @param {string} params.createdBy
 * @param {string} params.actorType
 * @param {string} [params.orderId]
 * @param {string} [params.orderItemId]
 * @param {object} [params.ua]
 * @param {string} [params.ipAddress]
 * @param {object} [params.qrService]
 * @returns {{ tokenId, rawToken, scanUrl, cardNumber, cardId, qrUrl }}
 */
export const generateSinglePreloadedToken = async ({
  schoolId,
  studentId,
  createdBy,
  actorType,
  orderId = null,
  orderItemId = null,
  ua = null,
  ipAddress = null,
  qrService,
}) => {
  // ── 1. Validate school + student + token limit ────────────────────────────
  const school = await validateSchool(schoolId);
  const validityMonths = school.settings?.token_validity_months ?? 12;
  const maxTokens = school.settings?.max_tokens_per_student ?? 1;
  const expiresAt = calculateExpiry(validityMonths);
  const branding = resolveBranding(school);
  const now = new Date();

  await validateStudent(studentId, schoolId);
  await checkTokenLimit(studentId, maxTokens);

  // ── 2. Generate raw token ─────────────────────────────────────────────────
  const rawToken = generateRawToken();
  const tokenHash = hashRawToken(rawToken);

  // ── 3. Save token (ACTIVE, linked to student) ─────────────────────────────
  const token = await repo.createPreloadedToken({
    schoolId,
    studentId,
    tokenHash,
    expiresAt,
    now,
    orderId,
    orderItemId,
  });

  // ── 4. Card number + scan URL ─────────────────────────────────────────────
  const [cardNumber] = await pregenerateCardNumbers(school.code, false, 1);
  const scanUrl = buildScanUrl(token.id);

  // ── 5. Generate QR PNG → S3 ───────────────────────────────────────────────
  // Note: student + emergency data are NOT passed to qrService here.
  // The QR image encodes only the scan URL — student data is fetched at scan time.
  // The full card design (with student photo etc) is done by card.service.js.
  const qrResult = await qrService.generateAndUpload({
    content: scanUrl,
    tokenId: token.id,
    schoolId,
    qrType: "SINGLE_PRE_DETAILS",
    branding,
    generatedBy: createdBy,
  });

  // ── 6. FIX [#4] — Save Card + QrAsset atomically ─────────────────────────
  // FIX [#2] — file_url: null
  // FIX [#1] — toQrTypeEnum → "PRE_DETAILS"
  const [card] = await repo.createCardWithQrAsset({
    cardData: {
      school_id: schoolId,
      student_id: studentId,
      token_id: token.id,
      card_number: cardNumber,
      file_url: null, // card.service.js fills this
      print_status: "PENDING",
    },
    qrData: {
      token_id: token.id,
      school_id: schoolId,
      storage_key: qrResult.storageKey,
      public_url: qrResult.publicUrl,
      format: "PNG",
      qr_type: toQrTypeEnum("SINGLE_PRE_DETAILS"), // FIX [#1] → "PRE_DETAILS"
      generated_by: createdBy,
      order_id: orderId,
      is_active: true,
    },
  });

  // ── 7. Audit log — fire-and-forget ────────────────────────────────────────
  audit({
    schoolId,
    actorId: createdBy,
    actorType,
    action: "TOKEN_GENERATE",
    entity: "Token",
    entityId: token.id,
    oldValue: null,
    newValue: {
      card_type: "SINGLE_PRE_DETAILS",
      status: "ACTIVE",
      student_id: studentId,
      card_number: cardNumber,
      card_id: card.id,
      order_id: orderId,
      order_item_id: orderItemId,
      expires_at: expiresAt,
      assigned_at: now,
      activated_at: now,
    },
    metadata: { type: "SINGLE_PRE_DETAILS" },
    ip: ipAddress,
  });

  return {
    tokenId: token.id,
    rawToken, // ⚠ shown once — never log, cache, or persist
    scanUrl,
    cardNumber,
    cardId: card.id,
    qrUrl: qrResult.publicUrl,
  };
};

// =============================================================================
// 4. BULK PRE-DETAILS TOKENS
// =============================================================================

/**
 * Generate tokens for multiple students — all ACTIVE immediately.
 * Students over token limit are skipped and reported separately.
 * Atomic DB transaction — all or nothing.
 *
 * @param {object}   params
 * @param {string}   params.schoolId
 * @param {string[]} params.studentIds
 * @param {string}   params.createdBy
 * @param {string}   params.actorType
 * @param {string}   [params.orderId]
 * @param {object}   [params.ua]
 * @param {string}   [params.ipAddress]
 * @param {string}   [params.notes]
 * @param {object}   [params.qrService]
 * @returns {{ batchId, tokens, skipped, summary }}
 */
export const generateBulkPreloadedTokens = async ({
  schoolId,
  studentIds,
  createdBy,
  actorType,
  orderId = null,
  ua = null,
  ipAddress = null,
  notes = null,
  qrService,
}) => {
  // ── 1. Validate school ────────────────────────────────────────────────────
  const school = await validateSchool(schoolId);
  const validityMonths = school.settings?.token_validity_months ?? 12;
  const maxTokens = school.settings?.max_tokens_per_student ?? 1;
  const expiresAt = calculateExpiry(validityMonths);
  const branding = resolveBranding(school);

  // ── 2. Validate input ─────────────────────────────────────────────────────
  if (!Array.isArray(studentIds) || studentIds.length === 0) {
    throw ApiError.badRequest("studentIds must be a non-empty array");
  }
  if (studentIds.length > MAX_BULK_LIMIT) {
    throw ApiError.badRequest(
      `Bulk limit is ${MAX_BULK_LIMIT} per request. Received: ${studentIds.length}`,
    );
  }

  // ── 3. Deduplicate + validate all students in 1 query ────────────────────
  const uniqueIds = [...new Set(studentIds)];
  const validStudents = await repo.findStudentsInSchool(uniqueIds, schoolId);
  const validSet = new Set(validStudents.map((s) => s.id));
  const invalidIds = uniqueIds.filter((id) => !validSet.has(id));

  if (invalidIds.length > 0) {
    throw ApiError.badRequest(
      `Invalid or out-of-school student IDs: ${invalidIds.join(", ")}`,
    );
  }

  // ── 4. Check token limits — 1 query for all students ─────────────────────
  const existingCounts = await repo.groupActiveTokenCountsByStudents(uniqueIds);
  const countMap = new Map(
    existingCounts.map((r) => [r.student_id, r._count.id]),
  );

  const skipped = [];
  const eligibleIds = [];

  for (const id of uniqueIds) {
    const count = countMap.get(id) ?? 0;
    if (count >= maxTokens) {
      skipped.push({ studentId: id, reason: "TOKEN_LIMIT_REACHED" });
    } else {
      eligibleIds.push(id);
    }
  }

  if (eligibleIds.length === 0) {
    throw ApiError.conflict("All students already have active tokens.");
  }

  // ── 5. Pre-generate all raw tokens in memory ──────────────────────────────
  const rawTokenData = eligibleIds.map((studentId) => {
    const rawToken = generateRawToken();
    const tokenHash = hashRawToken(rawToken);
    return { studentId, rawToken, tokenHash, expiresAt };
  });

  const hashToData = new Map(
    rawTokenData.map(({ tokenHash, rawToken, studentId }) => [
      tokenHash,
      { rawToken, studentId },
    ]),
  );

  // ── 6. FIX [#3] — Pre-generate all card numbers sequentially ─────────────
  const cardNumbers = await pregenerateCardNumbers(
    school.code,
    false,
    eligibleIds.length,
  );

  // ── 7. Atomic DB: TokenBatch + all Tokens ─────────────────────────────────
  const { batch, createdTokens } = await repo.createBatchWithPreloadedTokens({
    schoolId,
    orderId,
    count: eligibleIds.length,
    createdBy,
    notes,
    tokenData: rawTokenData,
  });

  // ── 8. Fetch all students + emergency in 2 parallel queries ───────────────
  // These are used by card.service.js for card design — passed through here
  // so card.service doesn't need to re-fetch what we already have.
  const [allStudents, allEmergency] = await Promise.all([
    repo.findManyStudentsForCard(eligibleIds),
    repo.findManyEmergencyProfilesForCard(eligibleIds),
  ]);

  const studentMap = new Map(allStudents.map((s) => [s.id, s]));
  const emergencyMap = new Map(allEmergency.map((e) => [e.student_id, e]));

  // ── 9. Build tokenData — pure CPU, no DB calls ────────────────────────────
  const tokenData = createdTokens.map((t, i) => {
    const data = hashToData.get(t.token_hash);
    if (!data) throw new Error(`Hash mismatch for token ${t.id}`);
    const scanUrl = buildScanUrl(t.id);
    return {
      tokenId: t.id,
      studentId: t.student_id,
      rawToken: data.rawToken,
      scanUrl,
      cardNumber: cardNumbers[i], // FIX [#3] — pre-generated above
      student: studentMap.get(t.student_id) ?? null,
      emergency: emergencyMap.get(t.student_id) ?? null,
    };
  });

  // ── 10. Generate all QR PNGs → S3 ────────────────────────────────────────
  const qrResults = await qrService.generateAndUploadBulk({
    items: tokenData.map((td) => ({
      content: td.scanUrl,
      tokenId: td.tokenId,
      schoolId,
      qrType: "BULK_PRE_DETAILS",
      branding,
      generatedBy: createdBy,
    })),
  });

  const qrByTokenId = new Map(qrResults.map((r) => [r.tokenId, r]));

  // ── 11. FIX [#4] — Save Card + QrAsset atomically per token ──────────────
  // FIX [#2] — file_url: null (card design fills this later)
  // FIX [#1] — toQrTypeEnum → "PRE_DETAILS"
  await Promise.all(
    tokenData.map((td) => {
      const qr = qrByTokenId.get(td.tokenId);
      return repo.createCardWithQrAsset({
        cardData: {
          school_id: schoolId,
          student_id: td.studentId,
          token_id: td.tokenId,
          card_number: td.cardNumber,
          file_url: null, // card.service.js fills this
          print_status: "PENDING",
        },
        qrData: {
          token_id: td.tokenId,
          school_id: schoolId,
          storage_key: qr.storageKey,
          public_url: qr.publicUrl,
          format: "PNG",
          qr_type: toQrTypeEnum("BULK_PRE_DETAILS"), // FIX [#1] → "PRE_DETAILS"
          generated_by: createdBy,
          order_id: orderId,
          is_active: true,
        },
      });
    }),
  );

  // ── 12. Audit log — fire-and-forget ───────────────────────────────────────
  audit({
    schoolId,
    actorId: createdBy,
    actorType,
    action: "TOKEN_GENERATE",
    entity: "TokenBatch",
    entityId: batch.id,
    oldValue: null,
    newValue: {
      card_type: "BULK_PRE_DETAILS",
      count: eligibleIds.length,
      order_id: orderId,
      status: "ACTIVE",
      expires_at: expiresAt,
      student_ids: eligibleIds,
    },
    metadata: {
      type: "BULK_PRE_DETAILS",
      notes,
      skipped_count: skipped.length,
      skipped_students: skipped,
    },
    ip: ipAddress,
  });

  // ── 13. Return ────────────────────────────────────────────────────────────
  // ⚠ rawToken array shown ONCE — never log, cache, or persist this response
  const tokens = tokenData.map((td) => ({
    // FIX [#5] — removed unused index param
    tokenId: td.tokenId,
    studentId: td.studentId,
    rawToken: td.rawToken,
    scanUrl: td.scanUrl,
    cardNumber: td.cardNumber,
    qrUrl: qrByTokenId.get(td.tokenId)?.publicUrl ?? null,
  }));

  return {
    batchId: batch.id,
    tokens,
    skipped,
    summary: {
      requested: studentIds.length,
      generated: tokens.length,
      skipped: skipped.length,
    },
  };
};
