// =============================================================================
// pipeline/step3.payment.js — RESQID
// CONFIRMED → PAYMENT_PENDING → ADVANCE_RECEIVED
//
// Two sub-actions:
//   sendAdvanceInvoiceStep()  — generate advance invoice → PAYMENT_PENDING
//   markAdvancePaidStep()     — record payment received → ADVANCE_RECEIVED
//
// BUG FIX [S3-1]: This file previously contained TOKEN GENERATION logic
// (runGenerate export). The controller imports sendAdvanceInvoiceStep and
// markAdvancePaidStep — those never existed here, causing runtime crashes on
// POST /api/orders/:id/invoice/advance and PATCH /api/orders/:id/payment/advance.
// File is now the correct PAYMENT step.
// =============================================================================

import * as repo from "../order.repository.js";
import { writeAuditLog } from "../../../utils/helpers/auditLogger.js";
import { ApiError } from "../../../utils/response/ApiError.js";

// =============================================================================
// STEP 3a — SEND ADVANCE INVOICE (CONFIRMED → PAYMENT_PENDING)
// =============================================================================

/**
 * Generate and link an advance invoice, move order to PAYMENT_PENDING.
 *
 * @param {object} params
 * @param {string} params.orderId
 * @param {string} params.adminId
 * @param {string|null} params.dueAt     — ISO datetime string, default 7 days
 * @param {string|null} params.note
 * @param {string} params.ip
 */
export const sendAdvanceInvoiceStep = async ({
  orderId,
  adminId,
  dueAt,
  note,
  ip,
}) => {
  // ── 1. Fetch + guard ────────────────────────────────────────────────────────
  const order = await repo.findOrderById(orderId);
  if (!order) throw ApiError.notFound("Order not found");

  // FIX [S3-2]: Check advance_invoice_id BEFORE status check.
  // If invoice already exists, return 409 regardless of current status.
  // Previously, the status check fired first — when order was PAYMENT_PENDING
  // (after first invoice), it returned 400 instead of the correct 409.
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

  // ── 2. Calculate invoice amounts ────────────────────────────────────────────
  const advanceAmount = order.advance_amount;
  const taxOnAdvance = Math.round(advanceAmount * 0.18);
  const invoiceTotal = advanceAmount + taxOnAdvance;
  const dueDate = dueAt
    ? new Date(dueAt)
    : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  // ── 3. Generate invoice number ──────────────────────────────────────────────
  const invoiceNumber = await repo.generateInvoiceNumber();

  // ── 4. Create invoice ───────────────────────────────────────────────────────
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

  // ── 5. Link invoice + set PAYMENT_PENDING ───────────────────────────────────
  await repo.linkAdvanceInvoiceToOrder({ orderId, invoiceId: invoice.id });
  const updated = await repo.setPaymentPending({ orderId, adminId });

  // ── 6. Status log ───────────────────────────────────────────────────────────
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

  // ── 7. Audit (fire-and-forget) ──────────────────────────────────────────────
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

/**
 * Record advance payment received, move order to ADVANCE_RECEIVED.
 *
 * @param {object} params
 * @param {string} params.orderId
 * @param {string} params.adminId
 * @param {number} params.amountReceived  — paise
 * @param {string} params.paymentMode
 * @param {string|null} params.paymentRef
 * @param {string|null} params.note
 * @param {string} params.ip
 */
export const markAdvancePaidStep = async ({
  orderId,
  adminId,
  amountReceived,
  paymentMode,
  paymentRef,
  note,
  ip,
}) => {
  // ── 1. Fetch + guard ────────────────────────────────────────────────────────
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

  // ── 2. Derive amounts ───────────────────────────────────────────────────────
  const invoiceId = order.advance_invoice_id;
  const advanceAmount = order.advance_amount;
  const taxOnAdvance = Math.round(advanceAmount * 0.18);
  const totalAmount = advanceAmount + taxOnAdvance;
  const received = amountReceived ?? totalAmount;
  const batchNumber = await repo.generateBatchNumber();

  // ── 3. Atomic: mark invoice paid + create batch + create payment + update order
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

  // ── 4. Status log ───────────────────────────────────────────────────────────
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

  // ── 5. Audit (fire-and-forget) ──────────────────────────────────────────────
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
