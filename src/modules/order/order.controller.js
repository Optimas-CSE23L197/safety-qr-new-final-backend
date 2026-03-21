// =============================================================================
// order.controller.js — RESQID
// HTTP layer only. No business logic.
// Extracts request data → calls pipeline step → sends ApiResponse.
// =============================================================================

import { ApiResponse } from "../../utils/response/ApiResponse.js";
import { asyncHandler } from "../../utils/response/asyncHandler.js";
import { extractIp } from "../../utils/network/extractIp.js";

import { createOrderStep } from "./pipeline/step1.create.js";
import { confirmOrderStep } from "./pipeline/step2.confirm.js";
import {
  sendAdvanceInvoiceStep,
  markAdvancePaidStep,
} from "./pipeline/step3.payment.js";
import { generateTokensStep } from "./pipeline/step4.generate.js";
import {
  generateCardDesignStep,
  retryCardDesignStep,
} from "./pipeline/step5.design.js";
import { sendToVendorStep } from "./pipeline/step6.vendor.js";
import {
  markPrintingStep,
  markPrintCompleteStep,
} from "./pipeline/step7.printing.js";
import {
  createShipmentStep,
  markShippedStep,
  markDeliveredStep,
} from "./pipeline/step8.shipment.js";
import {
  sendBalanceInvoiceStep,
  markBalancePaidStep,
} from "./pipeline/step9.complete.js";
import { cancelOrderStep, markRefundedStep } from "./pipeline/step10.cancel.js";
import { listOrders, findOrderById } from "./order.repository.js";

// =============================================================================
// READ
// =============================================================================

export const getOrders = asyncHandler(async (req, res) => {
  const { page, limit, status, school_id, channel } = req.query;

  const [orders, total] = await listOrders({
    page: parseInt(page) || 1,
    limit: parseInt(limit) || 20,
    status,
    schoolId: school_id,
    channel,
  });

  return ApiResponse.ok(
    { orders, total, page: parseInt(page) || 1 },
    "Orders fetched",
  ).send(res);
});

export const getOrderById = asyncHandler(async (req, res) => {
  const order = await findOrderById(req.params.id);
  if (!order)
    return res.status(404).json({ success: false, message: "Order not found" });

  // SEC: strip internal-only fields before sending to client.
  const {
    admin_notes,
    caller_name,
    caller_phone,
    call_notes,
    statusLogs,
    ...safeOrder
  } = order;

  return ApiResponse.ok({ order: safeOrder }, "Order fetched").send(res);
});

// =============================================================================
// STEP 1 — CREATE
// POST /api/orders
// =============================================================================

export const createOrder = asyncHandler(async (req, res) => {
  const {
    school_id,
    channel,
    order_type,
    card_count,
    delivery,
    caller_name,
    caller_phone,
    call_notes,
    notes,
    admin_notes,
  } = req.body;

  const result = await createOrderStep({
    schoolId: school_id,
    adminId: req.user.id,
    channel,
    orderType: order_type,
    cardCount: card_count,
    delivery: delivery ?? {},
    callContext: { caller_name, caller_phone, call_notes },
    notes,
    adminNotes: admin_notes,
    ip: extractIp(req),
  });

  return ApiResponse.created(result, "Order created successfully").send(res);
});

// =============================================================================
// STEP 2 — CONFIRM
// PATCH /api/orders/:id/confirm
// =============================================================================

export const confirmOrder = asyncHandler(async (req, res) => {
  const result = await confirmOrderStep({
    orderId: req.params.id,
    adminId: req.user.id,
    delivery: req.body.delivery ?? {},
    customUnitPrice: req.body.custom_unit_price ?? null,
    note: req.body.note,
    ip: extractIp(req),
  });

  return ApiResponse.ok(result, "Order confirmed").send(res);
});

// =============================================================================
// STEP 3a — SEND ADVANCE INVOICE
// POST /api/orders/:id/invoice/advance
// =============================================================================

export const sendAdvanceInvoice = asyncHandler(async (req, res) => {
  const result = await sendAdvanceInvoiceStep({
    orderId: req.params.id,
    adminId: req.user.id,
    dueAt: req.body.due_at,
    note: req.body.note,
    ip: extractIp(req),
  });

  return ApiResponse.created(result, "Advance invoice issued").send(res);
});

// =============================================================================
// STEP 3b — MARK ADVANCE PAID
// PATCH /api/orders/:id/payment/advance
// =============================================================================

export const markAdvancePaid = asyncHandler(async (req, res) => {
  const result = await markAdvancePaidStep({
    orderId: req.params.id,
    adminId: req.user.id,
    amountReceived: req.body.amount_received,
    paymentMode: req.body.payment_mode,
    paymentRef: req.body.payment_ref,
    note: req.body.note,
    ip: extractIp(req),
  });

  return ApiResponse.ok(result, "Advance payment recorded").send(res);
});

// =============================================================================
// STEP 4 — GENERATE TOKENS + QR
// POST /api/orders/:id/generate
// =============================================================================

export const generateTokens = asyncHandler(async (req, res) => {
  const result = await generateTokensStep({
    orderId: req.params.id,
    adminId: req.user.id,
    note: req.body.note,
    ip: extractIp(req),
  });

  // SEC: tokens[] contains tokenHash, cardNumber, scanUrl, qrUrl per token.
  // This data belongs in a secured internal export (CSV/encrypted delivery),
  // not in a JSON API response. Strip before sending — only counts go to client.
  // FIX [C-1]: was destructuring `rawTokens` (old field name). Step4 now
  // returns `tokens` — fixed to strip the correct field.
  const { tokens, ...safeResult } = result;

  return ApiResponse.created(
    safeResult,
    `${result.tokenCount} tokens generated`,
  ).send(res);
});

// =============================================================================
// STEP 5 — CARD DESIGN
// POST /api/orders/:id/design
// POST /api/orders/:id/design/retry
// =============================================================================

export const generateCardDesign = asyncHandler(async (req, res) => {
  const result = await generateCardDesignStep({
    orderId: req.params.id,
    adminId: req.user.id,
    note: req.body.note,
    ip: extractIp(req),
  });

  return ApiResponse.created(result, "Card designs generated").send(res);
});

export const retryCardDesign = asyncHandler(async (req, res) => {
  const result = await retryCardDesignStep({
    orderId: req.params.id,
    adminId: req.user.id,
    note: req.body.note,
    ip: extractIp(req),
  });

  return ApiResponse.created(result, "Card design retry complete").send(res);
});

// =============================================================================
// STEP 6 — SEND TO VENDOR
// PATCH /api/orders/:id/vendor
// =============================================================================

export const sendToVendor = asyncHandler(async (req, res) => {
  const result = await sendToVendorStep({
    orderId: req.params.id,
    adminId: req.user.id,
    vendorId: req.body.vendor_id,
    vendorNotes: req.body.vendor_notes,
    note: req.body.note,
    ip: extractIp(req),
  });

  return ApiResponse.ok(result, "Files sent to vendor").send(res);
});

// =============================================================================
// STEP 7 — PRINTING
// PATCH /api/orders/:id/printing/start
// PATCH /api/orders/:id/printing/complete
// =============================================================================

export const markPrintingStarted = asyncHandler(async (req, res) => {
  const result = await markPrintingStep({
    orderId: req.params.id,
    adminId: req.user.id,
    note: req.body.note,
    ip: extractIp(req),
  });

  return ApiResponse.ok(result, "Printing started").send(res);
});

export const markPrintingComplete = asyncHandler(async (req, res) => {
  const result = await markPrintCompleteStep({
    orderId: req.params.id,
    adminId: req.user.id,
    note: req.body.note,
    ip: extractIp(req),
  });

  return ApiResponse.ok(result, "Print complete").send(res);
});

// =============================================================================
// STEP 8 — SHIPMENT
// POST   /api/orders/:id/shipment
// PATCH  /api/orders/:id/shipment/shipped
// PATCH  /api/orders/:id/shipment/delivered
// =============================================================================

export const createShipment = asyncHandler(async (req, res) => {
  const result = await createShipmentStep({
    orderId: req.params.id,
    adminId: req.user.id,
    shiprocketOrderId: req.body.shiprocket_order_id,
    shiprocketShipmentId: req.body.shiprocket_shipment_id,
    awbCode: req.body.awb_code,
    courierName: req.body.courier_name,
    trackingUrl: req.body.tracking_url,
    labelUrl: req.body.label_url,
    note: req.body.note,
    ip: extractIp(req),
  });

  return ApiResponse.created(result, "Shipment created").send(res);
});

export const markShipped = asyncHandler(async (req, res) => {
  const result = await markShippedStep({
    orderId: req.params.id,
    adminId: req.user.id,
    trackingUrl: req.body.tracking_url,
    note: req.body.note,
    ip: extractIp(req),
  });

  return ApiResponse.ok(result, "Order marked as shipped").send(res);
});

export const markDelivered = asyncHandler(async (req, res) => {
  const result = await markDeliveredStep({
    orderId: req.params.id,
    adminId: req.user.id,
    note: req.body.note,
    ip: extractIp(req),
  });

  return ApiResponse.ok(
    result,
    `Order delivered. ${result.tokensIssued} tokens issued.`,
  ).send(res);
});

// =============================================================================
// STEP 9 — BALANCE INVOICE + PAYMENT
// POST  /api/orders/:id/invoice/balance
// PATCH /api/orders/:id/payment/balance
// =============================================================================

export const sendBalanceInvoice = asyncHandler(async (req, res) => {
  const result = await sendBalanceInvoiceStep({
    orderId: req.params.id,
    adminId: req.user.id,
    dueAt: req.body.due_at,
    note: req.body.note,
    ip: extractIp(req),
  });

  return ApiResponse.created(result, "Balance invoice issued").send(res);
});

export const markBalancePaid = asyncHandler(async (req, res) => {
  const result = await markBalancePaidStep({
    orderId: req.params.id,
    adminId: req.user.id,
    amountReceived: req.body.amount_received,
    paymentMode: req.body.payment_mode,
    paymentRef: req.body.payment_ref,
    note: req.body.note,
    ip: extractIp(req),
  });

  return ApiResponse.ok(result, "Order completed — full payment received").send(
    res,
  );
});

// =============================================================================
// STEP 10 — CANCEL + REFUND
// PATCH /api/orders/:id/cancel
// PATCH /api/orders/:id/refund
// =============================================================================

export const cancelOrder = asyncHandler(async (req, res) => {
  const result = await cancelOrderStep({
    orderId: req.params.id,
    adminId: req.user.id,
    reason: req.body.reason,
    ip: extractIp(req),
  });

  return ApiResponse.ok(
    result,
    result.requiresRefund
      ? "Order cancelled. Refund required — use /refund to record it."
      : "Order cancelled successfully.",
  ).send(res);
});

export const refundOrder = asyncHandler(async (req, res) => {
  const result = await markRefundedStep({
    orderId: req.params.id,
    adminId: req.user.id,
    amountRefunded: req.body.amount_refunded,
    refundRef: req.body.refund_ref,
    paymentMode: req.body.payment_mode,
    note: req.body.note,
    ip: extractIp(req),
  });

  return ApiResponse.ok(result, "Refund recorded").send(res);
});
