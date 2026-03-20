// =============================================================================
// pipeline/step9.complete.js — RESQID
// BALANCE_PENDING → COMPLETED
//
// Two sub-actions:
//   9a. sendBalanceInvoiceStep() — generate balance invoice (status stays BALANCE_PENDING)
//   9b. markBalancePaidStep()    — record payment → COMPLETED
//
// BUG FIX [S9-1]: createInvoice was called with snake_case params
// ({ school_id, subscription_id, invoice_number, invoice_type, amount, ... })
// but the repo function expected camelCase ({ schoolId, subscriptionId,
// invoiceNumber, invoiceType, amount, ... }). All fields resolved to undefined.
// Fixed in repo to accept both shapes; this step now uses camelCase.
//
// BUG FIX [S9-2]: createPayment was called with snake_case params
// ({ school_id, order_id, invoice_id, payment_mode, ... }) but the repo
// expected camelCase. Fixed in repo; this step now uses camelCase.
//
// BUG FIX [S9-3]: writeAuditLog param mismatch — fixed.
// =============================================================================

import {
  findOrderByIdRaw,
  generateInvoiceNumber,
  createInvoice,
  createPayment,
  updateOrder,
  updateInvoice,
  writeOrderStatusLog,
} from "../order.repository.js";

// FIX [A-1]: unified auditLogger — see step5 comment.
import { writeAuditLog } from "../../../utils/helpers/auditLogger.js";

import { assertValidTransition } from "../order.helpers.js";
import { ApiError } from "../../../utils/response/ApiError.js";

// =============================================================================
// 9a. SEND BALANCE INVOICE
// Called by order.controller.js → POST /api/orders/:id/invoice/balance
// =============================================================================

/**
 * Generate balance invoice (remaining 50%) — order stays BALANCE_PENDING.
 *
 * @param {object} params
 * @param {string} params.orderId
 * @param {string} params.adminId
 * @param {string|null} params.dueAt
 * @param {string|null} params.note
 * @param {string} params.ip
 */
export const sendBalanceInvoiceStep = async ({
  orderId,
  adminId,
  dueAt,
  note,
  ip,
}) => {
  const order = await findOrderByIdRaw(orderId);
  if (!order) throw new ApiError(404, "Order not found");

  if (order.status !== "BALANCE_PENDING") {
    throw new ApiError(
      400,
      `Order must be in BALANCE_PENDING. Current: ${order.status}`,
    );
  }

  if (!order.balance_amount) {
    throw new ApiError(400, "Balance amount not set on order");
  }

  if (order.balance_invoice_id) {
    throw new ApiError(409, "Balance invoice already exists for this order");
  }

  // Due date: from order (set at delivery) or param override or +7 days
  const dueDate = dueAt
    ? new Date(dueAt)
    : (order.balance_due_at ??
      (() => {
        const d = new Date();
        d.setDate(d.getDate() + 7);
        return d;
      })());

  const invoiceNumber = await generateInvoiceNumber();

  // Extract pre-tax amount from inclusive balance_amount (balance already includes GST)
  const balancePreTax = Math.round(order.balance_amount / 1.18);
  const balanceTax = order.balance_amount - balancePreTax;

  // BUG FIX [S9-1]: Use camelCase params to match repo signature.
  const invoice = await createInvoice({
    schoolId: order.school_id,
    subscriptionId: order.subscription_id ?? null,
    invoiceNumber,
    invoiceType: "BALANCE",
    amount: balancePreTax,
    taxAmount: balanceTax,
    totalAmount: order.balance_amount,
    dueAt: dueDate,
    notes: note ?? `Balance invoice for order ${order.order_number}`,
  });

  await updateOrder(orderId, {
    balance_invoice_id: invoice.id,
    balance_due_at: dueDate,
    status_changed_by: adminId,
    status_changed_at: new Date(),
  });

  // FIX [S9-4]: No status log was written here. Every pipeline event needs a
  // log entry so the admin can see the full order timeline. Status stays
  // BALANCE_PENDING — this is an event log entry, not a transition.
  await writeOrderStatusLog({
    orderId,
    fromStatus: "BALANCE_PENDING",
    toStatus: "BALANCE_PENDING",
    changedBy: adminId,
    note: note ?? `Balance invoice ${invoiceNumber} issued`,
    metadata: {
      invoice_id: invoice.id,
      invoice_number: invoiceNumber,
      total_amount: order.balance_amount,
      due_at: dueDate,
    },
  });

  writeAuditLog({
    actorId: adminId,
    actorType: "SUPER_ADMIN",
    schoolId: order.school_id,
    action: "BALANCE_INVOICE_ISSUED",
    entity: "Invoice",
    entityId: invoice.id,
    newValue: {
      invoice_number: invoiceNumber,
      total_amount: order.balance_amount,
      order_id: orderId,
      due_at: dueDate,
    },
    ip,
  }).catch(() => {});

  return { invoice };
};

// =============================================================================
// 9b. MARK BALANCE PAID → COMPLETED
// Called by order.controller.js → PATCH /api/orders/:id/payment/balance
// =============================================================================

/**
 * Record balance payment → order COMPLETED.
 *
 * @param {object} params
 * @param {string} params.orderId
 * @param {string} params.adminId
 * @param {number} params.amountReceived   — paise
 * @param {string} params.paymentMode
 * @param {string|null} params.paymentRef
 * @param {string|null} params.note
 * @param {string} params.ip
 */
export const markBalancePaidStep = async ({
  orderId,
  adminId,
  amountReceived,
  paymentMode,
  paymentRef,
  note,
  ip,
}) => {
  const order = await findOrderByIdRaw(orderId);
  if (!order) throw new ApiError(404, "Order not found");

  assertValidTransition(order.status, "COMPLETED");

  if (!amountReceived || amountReceived <= 0) {
    throw new ApiError(400, "amountReceived must be positive paise");
  }

  const now = new Date();

  // ── 1. Create Payment record ─────────────────────────────────────────────────
  // BUG FIX [S9-2]: Use camelCase params to match repo signature.
  const payment = await createPayment({
    schoolId: order.school_id,
    subscriptionId: order.subscription_id ?? null,
    orderId,
    invoiceId: order.balance_invoice_id ?? null,
    amount: amountReceived,
    taxAmount: 0,
    paymentMode: paymentMode ?? "BANK_TRANSFER",
    paymentRef: paymentRef ?? null,
    isAdvance: false,
    status: "SUCCESS",
    provider: "manual",
    metadata: {
      verified_by: adminId,
      note: note ?? null,
    },
  });

  // ── 2. Mark balance invoice PAID ─────────────────────────────────────────────
  if (order.balance_invoice_id) {
    await updateInvoice(order.balance_invoice_id, {
      status: "PAID",
      paid_at: now,
    });
  }

  // ── 3. Close order → COMPLETED ────────────────────────────────────────────────
  const updated = await updateOrder(orderId, {
    status: "COMPLETED",
    balance_paid_at: now,
    payment_status: "PAID",
    status_changed_by: adminId,
    status_changed_at: now,
    status_note: note ?? "Balance received — order fully closed",
  });

  // ── 4. OrderStatusLog ────────────────────────────────────────────────────────
  await writeOrderStatusLog({
    orderId,
    fromStatus: "BALANCE_PENDING",
    toStatus: "COMPLETED",
    changedBy: adminId,
    note: note ?? "Full payment received — order completed",
    metadata: {
      payment_id: payment.id,
      amount_received: amountReceived,
      payment_mode: paymentMode,
      payment_ref: paymentRef,
    },
  });

  writeAuditLog({
    actorId: adminId,
    actorType: "SUPER_ADMIN",
    schoolId: order.school_id,
    action: "ORDER_COMPLETED",
    entity: "CardOrder",
    entityId: orderId,
    oldValue: { status: "BALANCE_PENDING", payment_status: "PARTIALLY_PAID" },
    newValue: {
      status: "COMPLETED",
      payment_status: "PAID",
      balance_paid_at: now,
    },
    ip,
  }).catch(() => {});

  return { order: updated, payment };
};
