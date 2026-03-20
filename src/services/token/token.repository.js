// =============================================================================
// token.repository.js — RESQID
// All DB operations for token + card generation
// No business logic here — only Prisma calls
// =============================================================================

import { prisma } from "../../config/prisma.js";

// =============================================================================
// SCHOOL
// =============================================================================

/**
 * Find school with settings + latest subscription (for branding + validity).
 */
export const findSchoolWithSettings = (schoolId) => {
  return prisma.school.findUnique({
    where: { id: schoolId },
    select: {
      id: true,
      name: true,
      code: true,
      logo_url: true,
      phone: true,
      is_active: true,
      settings: {
        select: {
          token_validity_months: true,
          max_tokens_per_student: true,
        },
      },
      subscriptions: {
        orderBy: { created_at: "desc" },
        take: 1,
        select: { plan: true, status: true },
      },
    },
  });
};

// =============================================================================
// STUDENT
// =============================================================================

export const findStudentInSchool = (studentId, schoolId) => {
  return prisma.student.findFirst({
    where: { id: studentId, school_id: schoolId, is_active: true },
    select: { id: true },
  });
};

export const findStudentsInSchool = (studentIds, schoolId) => {
  return prisma.student.findMany({
    where: { id: { in: studentIds }, school_id: schoolId, is_active: true },
    select: { id: true },
  });
};

export const countActiveTokensForStudent = (studentId) => {
  return prisma.token.count({
    where: {
      student_id: studentId,
      status: { in: ["ACTIVE", "ISSUED"] },
    },
  });
};

export const groupActiveTokenCountsByStudents = (studentIds) => {
  return prisma.token.groupBy({
    by: ["student_id"],
    where: {
      student_id: { in: studentIds },
      status: { in: ["ACTIVE", "ISSUED"] },
    },
    _count: { id: true },
  });
};

// =============================================================================
// CARD NUMBER — collision-safe
// =============================================================================

/**
 * Check if a card number already exists.
 * Used by service to retry on collision (extremely rare — 16.7M combinations).
 */
export const cardNumberExists = (cardNumber) => {
  return prisma.card.findUnique({
    where: { card_number: cardNumber },
    select: { id: true },
  });
};

// =============================================================================
// TOKEN — single
// =============================================================================

/**
 * Create a single UNASSIGNED token (blank card flow).
 */
export const createToken = ({
  schoolId,
  tokenHash,
  expiresAt,
  orderId = null,
  orderItemId = null,
}) => {
  return prisma.token.create({
    data: {
      school_id: schoolId,
      token_hash: tokenHash,
      status: "UNASSIGNED",
      expires_at: expiresAt,
      order_id: orderId,
      order_item_id: orderItemId,
    },
  });
};

/**
 * Create a single ACTIVE token pre-linked to a student.
 */
export const createPreloadedToken = ({
  schoolId,
  studentId,
  tokenHash,
  expiresAt,
  now,
  orderId = null,
  orderItemId = null,
}) => {
  return prisma.token.create({
    data: {
      school_id: schoolId,
      student_id: studentId,
      token_hash: tokenHash,
      status: "ACTIVE",
      assigned_at: now,
      activated_at: now,
      expires_at: expiresAt,
      order_id: orderId,
      order_item_id: orderItemId,
    },
  });
};

// =============================================================================
// TOKEN BATCH — bulk
// =============================================================================

/**
 * Create TokenBatch + bulk UNASSIGNED tokens atomically.
 * Single transaction — all or nothing.
 */
export const createBatchWithTokens = ({
  schoolId,
  orderId = null,
  count,
  createdBy,
  notes,
  tokenData,
}) => {
  return prisma.$transaction(async (tx) => {
    const batch = await tx.tokenBatch.create({
      data: {
        school_id: schoolId,
        order_id: orderId,
        count,
        created_by: createdBy,
        notes,
      },
    });

    const createdTokens = await Promise.all(
      tokenData.map(({ tokenHash, expiresAt }) =>
        tx.token.create({
          data: {
            school_id: schoolId,
            batch_id: batch.id,
            order_id: orderId,
            token_hash: tokenHash,
            status: "UNASSIGNED",
            expires_at: expiresAt,
          },
        }),
      ),
    );

    return { batch, createdTokens };
  });
};

/**
 * Create TokenBatch + bulk ACTIVE tokens pre-linked to students atomically.
 */
export const createBatchWithPreloadedTokens = ({
  schoolId,
  orderId = null,
  count,
  createdBy,
  notes,
  tokenData,
}) => {
  return prisma.$transaction(async (tx) => {
    const batch = await tx.tokenBatch.create({
      data: {
        school_id: schoolId,
        order_id: orderId,
        count,
        created_by: createdBy,
        notes,
      },
    });

    const now = new Date();
    const createdTokens = await Promise.all(
      tokenData.map(({ studentId, tokenHash, expiresAt }) =>
        tx.token.create({
          data: {
            school_id: schoolId,
            student_id: studentId,
            batch_id: batch.id,
            order_id: orderId,
            token_hash: tokenHash,
            status: "ACTIVE",
            assigned_at: now,
            activated_at: now,
            expires_at: expiresAt,
          },
        }),
      ),
    );

    return { batch, createdTokens };
  });
};

// =============================================================================
// CARD + QR ASSET — always written together atomically
// =============================================================================

/**
 * FIX [#4] — Card + QrAsset written in a single transaction.
 * Previously two independent Promise.all writes — if QrAsset failed,
 * Card row existed with no QR URL (orphaned, invalid state).
 *
 * Card.file_url is intentionally null here — it belongs to the card DESIGN
 * step (card.service.js), not the token generation step. Token generation only
 * produces a QR PNG. The full composed card (logo + student + QR) comes later.
 *
 * FIX [#2] — fileUrl removed from this function entirely.
 * Card.file_url must be String? (nullable) in schema for this to work.
 *
 * @returns {Promise<[Card, QrAsset]>}
 */
export const createCardWithQrAsset = ({ cardData, qrData }) => {
  return prisma.$transaction([
    prisma.card.create({ data: cardData }),
    prisma.qrAsset.create({ data: qrData }),
  ]);
};

// =============================================================================
// QR ASSET — standalone (for single token flows where Card is separate)
// =============================================================================

export const createQrAsset = ({
  tokenId,
  schoolId,
  storageKey,
  publicUrl,
  qrType,
  generatedBy,
  orderId,
}) => {
  return prisma.qrAsset.create({
    data: {
      token_id: tokenId,
      school_id: schoolId,
      storage_key: storageKey,
      public_url: publicUrl,
      format: "PNG",
      qr_type: qrType, // already mapped to Prisma enum by caller
      generated_by: generatedBy,
      order_id: orderId ?? null,
      is_active: true,
    },
  });
};

// =============================================================================
// AUDIT LOG
// =============================================================================

export const writeAuditLog = ({
  schoolId,
  actorId,
  actorType,
  action,
  entity,
  entityId,
  oldValue,
  newValue,
  metadata,
  ip,
}) => {
  return prisma.auditLog.create({
    data: {
      school_id: schoolId ?? null,
      actor_id: actorId,
      actor_type: actorType,
      action,
      entity,
      entity_id: entityId,
      old_value: oldValue ?? null,
      new_value: newValue ?? null,
      metadata: metadata ?? null,
      ip_address: ip ?? null,
    },
  });
};

// =============================================================================
// CARD DATA — for card.service (card design step, runs after token generation)
// =============================================================================

export const findStudentForCard = (studentId) => {
  return prisma.student.findUnique({
    where: { id: studentId },
    select: {
      id: true,
      first_name: true,
      last_name: true,
      photo_url: true,
      class: true,
      section: true,
      gender: true,
    },
  });
};

export const findEmergencyProfileForCard = (studentId) => {
  return prisma.emergencyProfile.findUnique({
    where: { student_id: studentId },
    select: {
      blood_group: true,
      allergies: true,
      conditions: true,
      medications: true,
      contacts: {
        where: { is_active: true },
        orderBy: { priority: "asc" },
        select: {
          name: true,
          relationship: true,
          call_enabled: true,
          whatsapp_enabled: true,
        },
      },
    },
  });
};

export const findManyStudentsForCard = (studentIds) => {
  return prisma.student.findMany({
    where: { id: { in: studentIds } },
    select: {
      id: true,
      first_name: true,
      last_name: true,
      photo_url: true,
      class: true,
      section: true,
      gender: true,
    },
  });
};

export const findManyEmergencyProfilesForCard = (studentIds) => {
  return prisma.emergencyProfile.findMany({
    where: { student_id: { in: studentIds } },
    select: {
      student_id: true,
      blood_group: true,
      allergies: true,
      conditions: true,
      medications: true,
      contacts: {
        where: { is_active: true },
        orderBy: { priority: "asc" },
        select: {
          name: true,
          relationship: true,
          call_enabled: true,
          whatsapp_enabled: true,
        },
      },
    },
  });
};
