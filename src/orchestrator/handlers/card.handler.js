// =============================================================================
// handlers/card.handler.js — UPDATED (Keep all existing, just fix card number)
// =============================================================================

import crypto from 'crypto';
import { prisma } from '#config/prisma.js';

// =============================================================================
// CARD NUMBER GENERATION — Replace the vulnerable function
// =============================================================================

/**
 * Generate crypto-random card numbers (32 bits entropy, non-sequential)
 * Format: RQ-{SCHOOLSERIAL}-{8 HEX CHARS}
 * Example: RQ-0042-C0C3B7F4
 */
const generateCardNumber = schoolSerial => {
  const serial = String(schoolSerial).padStart(4, '0');
  const randomHex = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `RQ-${serial}-${randomHex}`;
};

/**
 * Batch generate multiple card numbers
 */
const batchGenerateCardNumbers = (schoolSerial, count) => {
  const serial = String(schoolSerial).padStart(4, '0');
  const cardNumbers = [];
  for (let i = 0; i < count; i++) {
    const randomHex = crypto.randomBytes(4).toString('hex').toUpperCase();
    cardNumbers.push(`RQ-${serial}-${randomHex}`);
  }
  return cardNumbers;
};

// =============================================================================
// FIX THE generateCardNumbers FUNCTION
// =============================================================================

/**
 * Generate card numbers for tokens — UPDATED to use crypto-random
 *
 * @param {string} orderId
 * @param {Array} tokens — tokens with student_id
 * @returns {Promise<Array>}
 */
export async function generateCardNumbers(orderId, tokens) {
  // Get school serial_number instead of UUID
  const order = await prisma.cardOrder.findUnique({
    where: { id: orderId },
    include: {
      school: {
        select: { serial_number: true, id: true },
      },
    },
  });

  if (!order) {
    throw new Error(`Order ${orderId} not found`);
  }

  const schoolSerial = order.school.serial_number;
  const cardNumbers = batchGenerateCardNumbers(schoolSerial, tokens.length);

  const cards = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const card = await prisma.card.create({
      data: {
        school_id: order.school_id,
        student_id: token.student_id,
        token_id: token.id,
        order_id: orderId,
        card_number: cardNumbers[i], // ← NOW CRYPTO-RANDOM
        print_status: 'PENDING',
      },
    });
    cards.push(card);
  }

  return cards;
}

// =============================================================================
// ALL OTHER FUNCTIONS REMAIN EXACTLY THE SAME
// =============================================================================

/**
 * Get cards by order
 */
export async function getCardsByOrder(orderId, filters = {}) {
  const where = { order_id: orderId };

  if (filters.print_status) {
    where.print_status = filters.print_status;
  }

  if (filters.studentId) {
    where.student_id = filters.studentId;
  }

  const cards = await prisma.card.findMany({
    where,
    include: {
      token: {
        include: {
          student: true,
          qrAsset: true,
        },
      },
      student: true,
    },
    orderBy: { created_at: 'asc' },
    take: filters.limit || 100,
    skip: filters.offset || 0,
  });

  const total = await prisma.card.count({ where });

  return { cards, total };
}

/**
 * Update card print status
 */
export async function updateCardPrintStatus(cardId, status, metadata = {}) {
  return prisma.card.update({
    where: { id: cardId },
    data: {
      print_status: status,
      printed_at: status === 'PRINTED' ? new Date() : undefined,
    },
  });
}

/**
 * Bulk update card print status
 */
export async function bulkUpdateCardPrintStatus(orderId, status, cardIds = null) {
  const where = { order_id: orderId };
  if (cardIds && cardIds.length > 0) {
    where.id = { in: cardIds };
  }

  return prisma.card.updateMany({
    where,
    data: {
      print_status: status,
      printed_at: status === 'PRINTED' ? new Date() : undefined,
    },
  });
}

/**
 * Get card by card number (for scanning) — NOTE: This is for SUPPORT ONLY
 * Primary scan flow uses QR codes with AES-SIV, not card numbers.
 */
export async function getCardByNumber(cardNumber) {
  const card = await prisma.card.findUnique({
    where: { card_number: cardNumber },
    include: {
      token: {
        include: {
          student: {
            include: {
              emergency: {
                include: { contacts: true },
              },
              school: true,
            },
          },
        },
      },
    },
  });

  if (!card) return null;

  return {
    id: card.id,
    cardNumber: card.card_number,
    token: card.token,
    student: card.token?.student,
    school: card.token?.student?.school,
    emergency: card.token?.student?.emergency,
  };
}

/**
 * Get card design preview URL
 */
export async function getCardDesignUrl(cardId) {
  const card = await prisma.card.findUnique({
    where: { id: cardId },
    select: { file_url: true, print_status: true },
  });

  return card?.file_url || null;
}
