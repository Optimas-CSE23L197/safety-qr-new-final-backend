// =============================================================================
// pipeline/step10.cancel.js — RESQID
// Order cancellation + refund — callable from any cancellable stage.
//
// BUG FIX [S10-1]: markRefundedStep used a dynamic import inside the function
// body (`const { createPayment } = await import(...)`) instead of a top-level
// static import. This is an anti-pattern: it breaks tree-shaking, adds latency
// on the hot path, and can silently fail on module resolution errors. Fixed to
// use a static import at the top of the file.
//
// BUG FIX [S10-2]: createPayment was called with snake_case params
// ({ school_id, order_id, invoice_id, payment_mode, ... }) but the repo
// function expected camelCase. All fields resolved to undefined. Fixed.
//
// BUG FIX [S10-3]: writeAuditLog param mismatch (actorId/actorType vs userId/role).
// Fixed via unified writeAuditLog in repo.
// =============================================================================

import {
  findOrderByIdRaw,
  updateOrder,
  createPayment,
  deactivateQrAssetsForOrder,
  writeOrderStatusLog,
} from "../order.repository.js";

// FIX [A-1]: unified auditLogger — see step5 comment.
import { writeAuditLog } from "../../../utils/helpers/auditLogger.js";

import { isCancellable, requiresRefund } from "../order.helpers.js";
import { ApiError } from "../../../utils/response/ApiError.js";
import { prisma } from "../../../config/prisma.js";

// =============================================================================
// CANCEL ORDER
// Called by order.controller.js → PATCH /api/orders/:id/cancel
// =============================================================================

/**
 * Cancel an order at any cancellable stage.
 * If advance was received → CANCELLED (refund handled separately via /refund).
 * If no payment yet → closes directly as CANCELLED.
 *
 * @param {object} params
 * @param {string} params.orderId
 * @param {string} params.adminId
 * @param {string} params.reason   — required for audit trail
 * @param {string} params.ip
 */
export const cancelOrderStep = async ({ orderId, adminId, reason, ip }) => {
  if (!reason?.trim()) {
    throw new ApiError(400, "Cancellation reason is required");
  }

  const order = await findOrderByIdRaw(orderId);
  if (!order) throw new ApiError(404, "Order not found");

  if (!isCancellable(order.status)) {
    throw new ApiError(
      400,
      `Order cannot be cancelled at status: ${order.status}. ` +
        `Orders past PRINT_COMPLETE cannot be cancelled.`,
    );
  }

  const hadPayment = requiresRefund(order.status);
  const now = new Date();

  // ── 1. Revoke all tokens if they were generated ───────────────────────────────
  const tokensRevoked = await revokeTokensIfGenerated(orderId);

  // ── 2. Deactivate QR assets ───────────────────────────────────────────────────
  if (tokensRevoked > 0) {
    await deactivateQrAssetsForOrder(orderId);
  }

  // ── 3. Update order → CANCELLED ──────────────────────────────────────────────
  const updated = await updateOrder(orderId, {
    status: "CANCELLED",
    status_changed_by: adminId,
    status_changed_at: now,
    status_note: reason,
  });

  // ── 4. OrderStatusLog ────────────────────────────────────────────────────────
  await writeOrderStatusLog({
    orderId,
    fromStatus: order.status,
    toStatus: "CANCELLED",
    changedBy: adminId,
    note: reason,
    metadata: {
      previous_status: order.status,
      tokens_revoked: tokensRevoked,
      had_payment: hadPayment,
      requires_refund: hadPayment,
      cancelled_at: now,
    },
  });

  writeAuditLog({
    actorId: adminId,
    actorType: "SUPER_ADMIN",
    schoolId: order.school_id,
    action: "ORDER_CANCELLED",
    entity: "CardOrder",
    entityId: orderId,
    oldValue: { status: order.status },
    newValue: {
      status: "CANCELLED",
      reason,
      tokens_revoked: tokensRevoked,
      requires_refund: hadPayment,
    },
    ip,
  }).catch(() => {});

  return {
    order: updated,
    tokensRevoked,
    requiresRefund: hadPayment,
  };
};

// =============================================================================
// MARK REFUNDED
// Called by order.controller.js → PATCH /api/orders/:id/refund
// =============================================================================

/**
 * Record that refund has been issued → status REFUNDED.
 *
 * @param {object} params
 * @param {string} params.orderId
 * @param {string} params.adminId
 * @param {number} params.amountRefunded   — paise
 * @param {string|null} params.refundRef   — UTR / UPI ref
 * @param {string} params.paymentMode
 * @param {string|null} params.note
 * @param {string} params.ip
 */
export const markRefundedStep = async ({
  orderId,
  adminId,
  amountRefunded,
  refundRef,
  paymentMode,
  note,
  ip,
}) => {
  const order = await findOrderByIdRaw(orderId);
  if (!order) throw new ApiError(404, "Order not found");

  if (order.status !== "CANCELLED") {
    throw new ApiError(400, "Order must be CANCELLED before marking refunded");
  }

  if (!amountRefunded || amountRefunded <= 0) {
    throw new ApiError(400, "amountRefunded must be positive paise");
  }

  const now = new Date();

  // ── 1. Create refund Payment record ─────────────────────────────────────────
  // BUG FIX [S10-1 + S10-2]: static import + camelCase params.
  const payment = await createPayment({
    schoolId: order.school_id,
    orderId,
    invoiceId: order.advance_invoice_id ?? null,
    amount: amountRefunded,
    taxAmount: 0,
    paymentMode: paymentMode ?? "BANK_TRANSFER",
    paymentRef: refundRef ?? null,
    isAdvance: false,
    status: "REFUNDED",
    provider: "manual",
    metadata: {
      refunded_by: adminId,
      note: note ?? null,
    },
  });

  // ── 2. Update order → REFUNDED ───────────────────────────────────────────────
  const updated = await updateOrder(orderId, {
    status: "REFUNDED",
    payment_status: "REFUNDED",
    status_changed_by: adminId,
    status_changed_at: now,
    status_note: note ?? `Refund issued: ₹${(amountRefunded / 100).toFixed(2)}`,
  });

  // ── 3. OrderStatusLog ────────────────────────────────────────────────────────
  await writeOrderStatusLog({
    orderId,
    fromStatus: "CANCELLED",
    toStatus: "REFUNDED",
    changedBy: adminId,
    note: note ?? "Refund processed",
    metadata: {
      payment_id: payment.id,
      amount_refunded: amountRefunded,
      refund_ref: refundRef,
      payment_mode: paymentMode,
    },
  });

  writeAuditLog({
    actorId: adminId,
    actorType: "SUPER_ADMIN",
    schoolId: order.school_id,
    action: "ORDER_REFUNDED",
    entity: "CardOrder",
    entityId: orderId,
    newValue: {
      status: "REFUNDED",
      payment_status: "REFUNDED",
      amount_refunded: amountRefunded,
      refund_ref: refundRef,
    },
    ip,
  }).catch(() => {});

  return { order: updated, payment };
};

// =============================================================================
// INTERNAL — revoke tokens atomically if any were generated for this order
// FIX [S10-4]: old code did findMany then updateMany — two separate queries.
// Between them another process could change token status (TOCTOU).
// Fixed: single updateMany returns count directly — atomic, no race condition.
// =============================================================================

const revokeTokensIfGenerated = async (orderId) => {
  const result = await prisma.token.updateMany({
    where: { order_id: orderId, status: { not: "REVOKED" } },
    data: { status: "REVOKED", revoked_at: new Date() },
  });
  return result.count;
};
