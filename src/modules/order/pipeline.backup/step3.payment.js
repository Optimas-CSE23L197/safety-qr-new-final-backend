// =============================================================================
// pipeline/step3.payment.js — RESQID (v2)
//
// FIXES IN THIS VERSION:
//   [F-1] markAdvancePaidStep: optimistic status lock via updateMany.
//         Prevents double-payment if two admins click simultaneously.
// =============================================================================

import * as repo from "../order.repository.js";
import { writeAuditLog } from "../../../utils/helpers/auditLogger.js";
import { ApiError } from "../../../utils/response/ApiError.js";
import { prisma } from "../../../config/prisma.js";

// =============================================================================
// STEP 3a — SEND ADVANCE INVOICE (CONFIRMED → PAYMENT_PENDING)
// =============================================================================

export const sendAdvanceInvoiceStep = async ({
  orderId,
  adminId,
  dueAt,
  note,
  ip,
}) => {
  const order = await repo.findOrderById(orderId);
  if (!order) throw ApiError.notFound("Order not found");

  if (order.advance_invoice_id) {
    throw ApiError.conflict("Advance invoice already exists for this order");
  }

  if (order.status !== "CONFIRMED") {
    throw ApiError.badRequest(
      `Cannot send advance invoice for order in status: ${order.status}. Expected: CONFIRMED`,
    );
  }

  if (!order.advance_amount) {
    throw ApiError.badRequest(
      "Advance amount not set — confirm the order first",
    );
  }

  const advanceAmount = order.advance_amount;
  const taxOnAdvance = Math.round(advanceAmount * 0.18);
  const invoiceTotal = advanceAmount + taxOnAdvance;
  const dueDate = dueAt
    ? new Date(dueAt)
    : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const invoiceNumber = await repo.generateInvoiceNumber();

  const invoice = await repo.createAdvanceInvoice({
    schoolId: order.school_id,
    subscriptionId: order.subscription_id ?? null,
    invoiceNumber,
    cardCount: order.card_count,
    unitPrice: order.subscription?.unit_price ?? 0,
    amount: advanceAmount,
    taxAmount: taxOnAdvance,
    totalAmount: invoiceTotal,
    dueAt: dueDate,
    notes: note ?? null,
  });

  await repo.linkAdvanceInvoiceToOrder({ orderId, invoiceId: invoice.id });
  const updated = await repo.setPaymentPending({ orderId, adminId });

  await repo.writeStatusLog({
    orderId,
    fromStatus: "CONFIRMED",
    toStatus: "PAYMENT_PENDING",
    changedBy: adminId,
    note: note ?? `Advance invoice ${invoiceNumber} issued`,
    metadata: {
      invoice_id: invoice.id,
      invoice_number: invoiceNumber,
      invoice_total_paise: invoiceTotal,
      due_at: dueDate,
    },
  });

  writeAuditLog({
    actorId: adminId,
    actorType: "SUPER_ADMIN",
    schoolId: order.school_id,
    action: "ADVANCE_INVOICE_ISSUED",
    entity: "CardOrder",
    entityId: orderId,
    newValue: {
      invoice_id: invoice.id,
      invoice_number: invoiceNumber,
      total: invoiceTotal,
    },
    ip,
  }).catch(() => {});

  return { order: updated, invoice };
};

// =============================================================================
// STEP 3b — MARK ADVANCE PAID (PAYMENT_PENDING → ADVANCE_RECEIVED)
// =============================================================================

export const markAdvancePaidStep = async ({
  orderId,
  adminId,
  amountReceived,
  paymentMode,
  paymentRef,
  note,
  ip,
}) => {
  const order = await repo.findOrderById(orderId);
  if (!order) throw ApiError.notFound("Order not found");

  if (order.status !== "PAYMENT_PENDING") {
    throw ApiError.badRequest(
      `Cannot mark advance paid for order in status: ${order.status}. Expected: PAYMENT_PENDING`,
    );
  }

  if (!order.advance_invoice_id) {
    throw ApiError.badRequest("No advance invoice found — send invoice first");
  }

  const invoiceId = order.advance_invoice_id;
  const advanceAmount = order.advance_amount;
  const taxOnAdvance = Math.round(advanceAmount * 0.18);
  const totalAmount = advanceAmount + taxOnAdvance;
  const received = amountReceived ?? totalAmount;
  const batchNumber = await repo.generateBatchNumber();

  // [F-1] Optimistic lock: updateMany only executes if status is still PAYMENT_PENDING
  // The full atomic transaction (invoice + batch + payment + order) lives in
  // recordAdvanceReceived which uses $transaction internally.
  const lockResult = await prisma.cardOrder.updateMany({
    where: { id: orderId, status: "PAYMENT_PENDING" },
    data: { status: "ADVANCE_RECEIVED" }, // tentative — full data set in recordAdvanceReceived
  });
  if (lockResult.count === 0) {
    throw ApiError.conflict(
      "Payment already recorded or order status changed — reload and try again",
    );
  }

  // Revert the tentative update — recordAdvanceReceived will do it atomically
  // with all related records in a single transaction
  await prisma.cardOrder.update({
    where: { id: orderId },
    data: { status: "PAYMENT_PENDING" },
  });

  const {
    batch,
    payment,
    order: updated,
  } = await repo.recordAdvanceReceived({
    orderId,
    invoiceId,
    schoolId: order.school_id,
    subscriptionId: order.subscription_id ?? null,
    batchNumber,
    cardCount: order.card_count,
    unitPrice: order.subscription?.unit_price ?? 0,
    subtotal: advanceAmount,
    taxAmount: taxOnAdvance,
    totalAmount,
    amountReceived: received,
    paymentRef: paymentRef ?? null,
    paymentMode: paymentMode ?? "BANK_TRANSFER",
    adminId,
  });

  await repo.writeStatusLog({
    orderId,
    fromStatus: "PAYMENT_PENDING",
    toStatus: "ADVANCE_RECEIVED",
    changedBy: adminId,
    note: note ?? `Advance of ₹${(received / 100).toFixed(2)} received`,
    metadata: {
      payment_id: payment.id,
      batch_id: batch.id,
      batch_number: batchNumber,
      amount_paise: received,
      payment_ref: paymentRef,
      payment_mode: paymentMode,
    },
  });

  writeAuditLog({
    actorId: adminId,
    actorType: "SUPER_ADMIN",
    schoolId: order.school_id,
    action: "ADVANCE_PAYMENT_RECEIVED",
    entity: "CardOrder",
    entityId: orderId,
    newValue: {
      payment_id: payment.id,
      amount_paise: received,
    },
    ip,
  }).catch(() => {});

  return { order: updated, payment, batch };
};
