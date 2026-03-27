// =============================================================================
// handlers/token.handler.js
// Business logic for token generation and management.
// Called by token.worker.js.
// =============================================================================

import { prisma } from '#config/database/prisma.js';
import crypto from 'crypto';
import { logger } from '#config/logger.js';

/**
 * Generate a secure token hash
 */
export function generateTokenHash() {
  const rawToken = crypto.randomBytes(32).toString('hex');
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

/**
 * Generate QR asset URL for token
 */
export async function generateQrAsset(tokenId, schoolId, orderId, qrType) {
  // This would integrate with your qr.service.js
  // For now, return placeholder
  return {
    storageKey: `qr/${schoolId}/${tokenId}.png`,
    publicUrl: `https://cdn.resqid.com/qr/${schoolId}/${tokenId}.png`,
    format: 'PNG',
  };
}

/**
 * Create tokens for an order
 */
export async function createTokensForOrder(orderId, schoolId, count, orderType, items = []) {
  const tokens = [];
  const batch = await prisma.tokenBatch.create({
    data: {
      school_id: schoolId,
      order_id: orderId,
      count,
      status: 'PROCESSING',
      created_by: 'system',
    },
  });

  for (let i = 0; i < count; i++) {
    const orderItem = items[i];
    const tokenData = {
      school_id: schoolId,
      order_id: orderId,
      token_hash: generateTokenHash(),
      status: 'UNASSIGNED',
      batch_id: batch.id,
    };

    if (orderItem && orderType === 'PRE_DETAILS') {
      tokenData.order_item_id = orderItem.id;
      tokenData.student_id = orderItem.student_id;
    }

    const token = await prisma.token.create({ data: tokenData });

    // Generate QR asset
    const qrAsset = await generateQrAsset(token.id, schoolId, orderId, orderType);

    await prisma.qrAsset.create({
      data: {
        token_id: token.id,
        school_id: schoolId,
        storage_key: qrAsset.storageKey,
        public_url: qrAsset.publicUrl,
        format: qrAsset.format,
        qr_type: orderType,
        generated_by: 'system',
        order_id: orderId,
      },
    });

    tokens.push(token);
  }

  await prisma.tokenBatch.update({
    where: { id: batch.id },
    data: {
      status: 'COMPLETE',
      generated_count: tokens.length,
      completed_at: new Date(),
    },
  });

  return { tokens, batchId: batch.id };
}

/**
 * Assign token to student (for BLANK orders)
 */
export async function assignTokenToStudent(tokenId, studentId) {
  const token = await prisma.token.update({
    where: { id: tokenId },
    data: {
      student_id: studentId,
      status: 'ISSUED',
      assigned_at: new Date(),
    },
  });

  // Update CardOrderItem if this token belongs to PRE_DETAILS order
  if (token.order_item_id) {
    await prisma.cardOrderItem.update({
      where: { id: token.order_item_id },
      data: {
        student_id: studentId,
        status: 'TOKEN_GENERATED',
      },
    });
  }

  return token;
}

/**
 * Get tokens by order
 */
export async function getTokensByOrder(orderId, filters = {}) {
  const where = { order_id: orderId };

  if (filters.status) {
    where.status = filters.status;
  }

  if (filters.studentId) {
    where.student_id = filters.studentId;
  }

  return prisma.token.findMany({
    where,
    include: {
      student: true,
      qrAsset: true,
      scans: {
        orderBy: { created_at: 'desc' },
        take: 10,
      },
    },
    orderBy: { created_at: 'asc' },
  });
}

/**
 * Revoke token (on cancellation or replacement)
 */
export async function revokeToken(tokenId, reason, revokedBy) {
  return prisma.token.update({
    where: { id: tokenId },
    data: {
      status: 'REVOKED',
      revoked_at: new Date(),
    },
  });
}

/**
 * Activate token (after parent registration)
 */
export async function activateToken(tokenId, studentId) {
  const token = await prisma.token.update({
    where: { id: tokenId },
    data: {
      student_id: studentId,
      status: 'ACTIVE',
      activated_at: new Date(),
      assigned_at: new Date(),
    },
  });

  // Update CardOrderItem if exists
  if (token.order_item_id) {
    await prisma.cardOrderItem.update({
      where: { id: token.order_item_id },
      data: {
        student_id: studentId,
        status: 'TOKEN_GENERATED',
      },
    });
  }

  return token;
}

/**
 * Check if token is valid for scan
 */
export async function validateTokenForScan(tokenHash) {
  const token = await prisma.token.findUnique({
    where: { token_hash: tokenHash },
    include: {
      student: {
        include: {
          emergency: {
            include: {
              contacts: true,
            },
          },
          school: true,
        },
      },
      qrAsset: true,
    },
  });

  if (!token) {
    return { valid: false, reason: 'NOT_FOUND' };
  }

  if (token.status !== 'ACTIVE') {
    return { valid: false, reason: token.status };
  }

  if (token.expires_at && token.expires_at < new Date()) {
    return { valid: false, reason: 'EXPIRED' };
  }

  return {
    valid: true,
    token,
    student: token.student,
    school: token.student?.school,
    emergency: token.student?.emergency,
  };
}

// Add this function to handlers/token.handler.js

/**
 * Create tokens for order with resume capability
 */
export async function createTokensForOrderResumable(
  orderId,
  schoolId,
  count,
  orderType,
  items = []
) {
  // Check existing tokens
  const existingTokens = await prisma.token.count({
    where: { order_id: orderId },
  });

  if (existingTokens >= count) {
    return {
      tokens: [],
      batchId: null,
      skipped: true,
      existingCount: existingTokens,
    };
  }

  const startIndex = existingTokens;
  const remainingCount = count - existingTokens;

  let tokenBatch = await prisma.tokenBatch.findFirst({
    where: { order_id: orderId, status: { in: ['PENDING', 'PROCESSING'] } },
  });

  if (!tokenBatch) {
    tokenBatch = await prisma.tokenBatch.create({
      data: {
        school_id: schoolId,
        order_id: orderId,
        count,
        status: 'PROCESSING',
        created_by: 'system',
      },
    });
  } else if (tokenBatch.status === 'PROCESSING') {
    await prisma.tokenBatch.update({
      where: { id: tokenBatch.id },
      data: { status: 'PROCESSING' },
    });
  }

  const tokens = [];

  for (let i = startIndex; i < count; i++) {
    const orderItem = items[i];
    const tokenData = {
      school_id: schoolId,
      order_id: orderId,
      token_hash: generateTokenHash(),
      status: orderType === 'PRE_DETAILS' ? 'ACTIVE' : 'UNASSIGNED',
      batch_id: tokenBatch.id,
    };

    if (orderItem && orderType === 'PRE_DETAILS') {
      tokenData.order_item_id = orderItem.id;
      tokenData.student_id = orderItem.student_id;
      tokenData.assigned_at = new Date();
      tokenData.activated_at = new Date();
    }

    const token = await prisma.token.create({ data: tokenData });

    // Generate QR (simplified - use your actual QR service)
    const qrAsset = await generateQrAsset(token.id, schoolId, orderId, orderType);
    await prisma.qrAsset.create({
      data: {
        token_id: token.id,
        school_id: schoolId,
        storage_key: qrAsset.storageKey,
        public_url: qrAsset.publicUrl,
        format: qrAsset.format,
        qr_type: orderType,
        generated_by: 'system',
        order_id: orderId,
      },
    });

    tokens.push(token);
  }

  await prisma.tokenBatch.update({
    where: { id: tokenBatch.id },
    data: {
      status: tokens.length === remainingCount ? 'COMPLETE' : 'PARTIAL',
      generated_count: tokens.length + existingTokens,
      completed_at: new Date(),
    },
  });

  return {
    tokens,
    batchId: tokenBatch.id,
    startIndex,
    generatedCount: tokens.length,
  };
}
