// =============================================================================
// order.routes.js — RESQID
// All order pipeline routes.
// All routes: authenticateSuperAdmin → validate → asyncHandler (in controller)
// =============================================================================

import { Router } from "express";
import { validate } from "../../middleware/validate.middleware.js";
import { authenticate } from "../../middleware/auth.middleware.js";

import {
  getOrders,
  getOrderById,
  createOrder,
  confirmOrder,
  sendAdvanceInvoice,
  markAdvancePaid,
  generateTokens,
  generateCardDesign,
  retryCardDesign,
  sendToVendor,
  markPrintingStarted,
  markPrintingComplete,
  createShipment,
  markShipped,
  markDelivered,
  sendBalanceInvoice,
  markBalancePaid,
  cancelOrder,
  refundOrder,
} from "./order.controller.js";

import {
  listOrdersSchema,
  createOrderSchema,
  confirmOrderSchema,
  advanceInvoiceSchema,
  advancePaymentSchema,
  generateTokensSchema,
  cardDesignSchema,
  vendorSchema,
  printingSchema,
  createShipmentSchema,
  shippedSchema,
  deliveredSchema,
  balanceInvoiceSchema,
  balancePaymentSchema,
  cancelOrderSchema,
  refundOrderSchema,
} from "./order.validation.js";

const router = Router();

// All order routes require super admin auth
router.use(authenticate);

// =============================================================================
// READ
// =============================================================================

router.get("/", validate(listOrdersSchema), getOrders);
router.get("/:id", getOrderById);

// =============================================================================
// STEP 1 — CREATE ORDER
// POST /api/orders
// =============================================================================

router.post("/", validate(createOrderSchema), createOrder);

// =============================================================================
// STEP 2 — CONFIRM
// PATCH /api/orders/:id/confirm
// =============================================================================

router.patch("/:id/confirm", validate(confirmOrderSchema), confirmOrder);

// =============================================================================
// STEP 3 — PAYMENT
// POST  /api/orders/:id/invoice/advance
// PATCH /api/orders/:id/payment/advance
// =============================================================================

router.post(
  "/:id/invoice/advance",
  validate(advanceInvoiceSchema),
  sendAdvanceInvoice,
);
router.patch(
  "/:id/payment/advance",
  validate(advancePaymentSchema),
  markAdvancePaid,
);

// =============================================================================
// STEP 4 — GENERATE TOKENS + QR
// POST /api/orders/:id/generate
// =============================================================================

router.post("/:id/generate", validate(generateTokensSchema), generateTokens);

// =============================================================================
// STEP 5 — CARD DESIGN
// POST /api/orders/:id/design
// POST /api/orders/:id/design/retry
// =============================================================================

router.post("/:id/design", validate(cardDesignSchema), generateCardDesign);
router.post("/:id/design/retry", validate(cardDesignSchema), retryCardDesign);

// =============================================================================
// STEP 6 — VENDOR
// PATCH /api/orders/:id/vendor
// =============================================================================

router.patch("/:id/vendor", validate(vendorSchema), sendToVendor);

// =============================================================================
// STEP 7 — PRINTING
// PATCH /api/orders/:id/printing/start
// PATCH /api/orders/:id/printing/complete
// =============================================================================

router.patch(
  "/:id/printing/start",
  validate(printingSchema),
  markPrintingStarted,
);
router.patch(
  "/:id/printing/complete",
  validate(printingSchema),
  markPrintingComplete,
);

// =============================================================================
// STEP 8 — SHIPMENT
// POST  /api/orders/:id/shipment
// PATCH /api/orders/:id/shipment/shipped
// PATCH /api/orders/:id/shipment/delivered
// =============================================================================

router.post("/:id/shipment", validate(createShipmentSchema), createShipment);
router.patch("/:id/shipment/shipped", validate(shippedSchema), markShipped);
router.patch(
  "/:id/shipment/delivered",
  validate(deliveredSchema),
  markDelivered,
);

// =============================================================================
// STEP 9 — BALANCE + COMPLETE
// POST  /api/orders/:id/invoice/balance
// PATCH /api/orders/:id/payment/balance
// =============================================================================

router.post(
  "/:id/invoice/balance",
  validate(balanceInvoiceSchema),
  sendBalanceInvoice,
);
router.patch(
  "/:id/payment/balance",
  validate(balancePaymentSchema),
  markBalancePaid,
);

// =============================================================================
// STEP 10 — CANCEL + REFUND
// PATCH /api/orders/:id/cancel
// PATCH /api/orders/:id/refund
// =============================================================================

router.patch("/:id/cancel", validate(cancelOrderSchema), cancelOrder);
router.patch("/:id/refund", validate(refundOrderSchema), refundOrder);

export default router;
