// =============================================================================
// orchestrator/handlers/card.handler.js — RESQID
// Card record management helpers.
// generateCardNumbers uses authoritative helpers from token.helpers.js —
// no local duplicates that can drift.
// =============================================================================

import { prisma } from '#config/prisma.js';
import { logger } from '#config/logger.js';

// Authoritative card number generators — single source of truth
import { generateCardNumber, batchGenerateCardNumbers } from '#services/token/token.helpers.js';

// =============================================================================
// Card number generation for orders
// =============================================================================

/**
 * Generate card numbers for tokens and persist Card records.
 *
 * @param {string} orderId
 * @param {Array} tokens — tokens with student_id
 * @returns {Promise<Array>}
 */
export async function generateCardNumbers(orderId, tokens) {
  const order = await prisma.cardOrder.findUnique({
    where: { id: orderId },
    include: {
      school: { select: { serial_number: true, id: true } },
    },
  });

  if (!order) throw new Error(`Order ${orderId} not found`);

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
        card_number: cardNumbers[i],
        print_status: 'PENDING',
      },
    });
    cards.push(card);
  }

  return cards;
}

// =============================================================================
// Card queries and updates
// =============================================================================

/**
 * Get cards by order with optional filters.
 */
export async function getCardsByOrder(orderId, filters = {}) {
  const where = { order_id: orderId };

  if (filters.print_status) where.print_status = filters.print_status;
  if (filters.studentId) where.student_id = filters.studentId;

  const [cards, total] = await Promise.all([
    prisma.card.findMany({
      where,
      include: {
        token: { include: { student: true, qrAsset: true } },
        student: true,
      },
      orderBy: { created_at: 'asc' },
      take: filters.limit || 100,
      skip: filters.offset || 0,
    }),
    prisma.card.count({ where }),
  ]);

  return { cards, total };
}

/**
 * Update print status of a single card.
 */
export async function updateCardPrintStatus(cardId, status) {
  return prisma.card.update({
    where: { id: cardId },
    data: {
      print_status: status,
      printed_at: status === 'PRINTED' ? new Date() : undefined,
    },
  });
}

/**
 * Bulk update print status for all cards in an order (or a subset).
 */
export async function bulkUpdateCardPrintStatus(orderId, status, cardIds = null) {
  const where = { order_id: orderId };
  if (cardIds && cardIds.length > 0) where.id = { in: cardIds };

  return prisma.card.updateMany({
    where,
    data: {
      print_status: status,
      printed_at: status === 'PRINTED' ? new Date() : undefined,
    },
  });
}

/**
 * Look up a card by card number.
 * NOTE: For support use only. Primary scan flow uses QR/AES-SIV, not card numbers.
 */
export async function getCardByNumber(cardNumber) {
  const card = await prisma.card.findUnique({
    where: { card_number: cardNumber },
    include: {
      token: {
        include: {
          student: {
            include: {
              emergency: { include: { contacts: true } },
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
 * Get the design file URL for a card.
 */
export async function getCardDesignUrl(cardId) {
  const card = await prisma.card.findUnique({
    where: { id: cardId },
    select: { file_url: true, print_status: true },
  });

  return card?.file_url ?? null;
}
