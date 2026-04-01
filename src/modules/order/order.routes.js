// =============================================================================
// order.routes.js — RESQID (FIXED ROUTE CONFLICTS)
// =============================================================================

import { Router } from 'express';
import { authenticate } from '#middleware/auth/auth.middleware.js';
import { validate } from '#middleware/validate.middleware.js';
import { ownSchoolOnly } from '#middleware/restrictionOwnSchool.middleware.js';
import { rbac } from '#middleware/auth/rbac.middleware.js';

import * as controller from './order.controller.js';
import * as validation from './order.validation.js';
import { getQueueHealth } from '#orchestrator/queues/queue.manager.js';

const router = Router();

// All order routes require authentication
router.use(authenticate);

// Role shortcuts
const superAdmin = rbac(['SUPER_ADMIN']);
const schoolAdmin = rbac(['SCHOOL_ADMIN', 'SUPER_ADMIN']);

// =============================================================================
// INVOICE ROUTES - MUST BE BEFORE /:orderId routes to avoid conflict
// =============================================================================

// ✅ MOVED HERE to avoid conflict with /:orderId
router.get('/invoices/:invoiceId', schoolAdmin, controller.getInvoiceById);

// =============================================================================
// ORDER CRUD
// =============================================================================

router.post('/', schoolAdmin, validate(validation.createOrderSchema), controller.createOrder);

router.get('/', validate(validation.listOrdersSchema, 'query'), controller.listOrders);

router.get('/:orderId', schoolAdmin, ownSchoolOnly, controller.getOrderDetails);

router.get('/:orderId/status', schoolAdmin, ownSchoolOnly, controller.getOrderStatus);

// =============================================================================
// CONFIRM & INVOICE
// =============================================================================

router.patch(
  '/:orderId/confirm',
  superAdmin,
  validate(validation.confirmOrderSchema),
  controller.confirmOrder
);

router.post('/:orderId/invoice/advance', superAdmin, controller.generateAdvanceInvoice);

// =============================================================================
// INVOICE — DOWNLOAD (after the specific invoice route)
// =============================================================================

router.get('/:orderId/invoice/:type', schoolAdmin, ownSchoolOnly, controller.downloadInvoice);

// =============================================================================
// PAYMENT
// =============================================================================

router.patch(
  '/:orderId/payment/advance',
  superAdmin,
  validate(validation.paymentSchema),
  controller.recordAdvancePayment
);

router.patch(
  '/:orderId/payment/balance',
  superAdmin,
  validate(validation.paymentSchema),
  controller.recordBalancePayment
);

// =============================================================================
// TOKEN GENERATION
// =============================================================================

router.post('/:orderId/tokens/generate', superAdmin, controller.generateTokens);

// =============================================================================
// CARD DESIGN
// =============================================================================

router.post('/:orderId/design/generate', superAdmin, controller.generateCardDesigns);

// =============================================================================
// VENDOR
// =============================================================================

router.patch(
  '/:orderId/vendor',
  superAdmin,
  validate(validation.assignVendorSchema),
  controller.assignVendor
);

// =============================================================================
// PRINTING
// =============================================================================

router.patch(
  '/:orderId/printing',
  superAdmin,
  validate(validation.printingStatusSchema),
  controller.updatePrintingStatus
);

// =============================================================================
// SHIPMENT
// =============================================================================

router.post(
  '/:orderId/shipment',
  superAdmin,
  validate(validation.createShipmentSchema),
  controller.createShipment
);

router.patch(
  '/:orderId/shipment/shipped',
  superAdmin,
  validate(validation.markShippedSchema),
  controller.markShipmentShipped
);

// =============================================================================
// DELIVERY
// =============================================================================

router.patch(
  '/:orderId/shipment/delivered',
  superAdmin,
  validate(validation.deliverySchema),
  controller.confirmDelivery
);

// =============================================================================
// CANCELLATION
// =============================================================================

router.post(
  '/:orderId/cancel',
  superAdmin,
  validate(validation.cancelOrderSchema),
  controller.cancelOrder
);

// =============================================================================
// HEALTH
// =============================================================================

// ✅ Added superAdmin guard
router.get('/orchestrator/health', superAdmin, async (req, res) => {
  const health = await getQueueHealth();
  res.json({ success: true, data: health });
});

export default router;
