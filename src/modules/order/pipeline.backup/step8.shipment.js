// =============================================================================
// pipeline/step8.shipment.js — RESQID
// PRINT_COMPLETE → READY_TO_SHIP → SHIPPED → DELIVERED → BALANCE_PENDING
//
// Three sub-actions:
//   8a. createShipmentStep() — Shiprocket order created → READY_TO_SHIP
//   8b. markShippedStep()    — picked up → SHIPPED
//   8c. markDeliveredStep()  — delivered to school → DELIVERED → BALANCE_PENDING
//
// BUG FIX [S8-1]: createShipment was called with snake_case field names
// (order_id, shiprocket_order_id, pickup_vendor_id ...) but the repo function
// expects camelCase params (orderId, shiprocketOrderId, pickupVendorId ...).
// All fields were undefined — createShipment created a blank row.
//
// BUG FIX [S8-2]: updateShipment(orderId, data) was calling the repo with an
// orderId but the repo keyed on { id: shipmentId }. The repo is now fixed to
// key on { order_id: orderId } (OrderShipment has a @unique order_id). This
// step passes orderId — correct.
//
// BUG FIX [S8-3]: bulkUpdateTokenStatus(tokenIds, "ISSUED") was passing a
// tokenIds *array* as the first argument. The repo expected an orderId string
// (or options object). The array was being used as orderId in a Prisma where
// clause, producing a type error. Fixed: now passes (orderId, "ISSUED") which
// the updated repo handles correctly.
// =============================================================================

import {
  findOrderByIdRaw,
  findVendorById,
  createShipment,
  updateShipment,
  updateOrder,
  bulkUpdateTokenStatus,
  writeOrderStatusLog,
} from "../order.repository.js";

// FIX [A-1]: unified auditLogger — see step5 comment.
import { writeAuditLog } from "../../../utils/helpers/auditLogger.js";

import {
  assertValidTransition,
  calculateBalanceDueDate,
} from "../order.helpers.js";
import { ApiError } from "../../../utils/response/ApiError.js";

// =============================================================================
// 8a. CREATE SHIPMENT
// Called by order.controller.js → POST /api/orders/:id/shipment
// =============================================================================

/**
 * Create Shiprocket shipment record → status READY_TO_SHIP.
 *
 * @param {object} params
 * @param {string} params.orderId
 * @param {string} params.adminId
 * @param {string|null} params.shiprocketOrderId
 * @param {string|null} params.shiprocketShipmentId
 * @param {string|null} params.awbCode
 * @param {string|null} params.courierName
 * @param {string|null} params.trackingUrl
 * @param {string|null} params.labelUrl
 * @param {string|null} params.note
 * @param {string} params.ip
 */
export const createShipmentStep = async ({
  orderId,
  adminId,
  shiprocketOrderId,
  shiprocketShipmentId,
  awbCode,
  courierName,
  trackingUrl,
  labelUrl,
  note,
  ip,
}) => {
  // ── 1. Load order ────────────────────────────────────────────────────────────
  const order = await findOrderByIdRaw(orderId);
  if (!order) throw new ApiError(404, "Order not found");

  assertValidTransition(order.status, "READY_TO_SHIP");

  // ── 2. Validate delivery address complete ────────────────────────────────────
  if (
    !order.delivery_name ||
    !order.delivery_address ||
    !order.delivery_pincode
  ) {
    throw new ApiError(400, "Delivery address incomplete on order");
  }

  // ── 3. Load vendor for pickup address snapshot ────────────────────────────────
  let vendor = null;
  if (order.vendor_id) {
    vendor = await findVendorById(order.vendor_id);
  }

  const now = new Date();

  // ── 4. Create OrderShipment row ───────────────────────────────────────────────
  // BUG FIX [S8-1]: Use camelCase params to match repo signature.
  const shipment = await createShipment({
    orderId,
    shiprocketOrderId: shiprocketOrderId ?? null,
    shiprocketShipmentId: shiprocketShipmentId ?? null,
    awbCode: awbCode ?? null,
    courierName: courierName ?? null,
    trackingUrl: trackingUrl ?? null,
    labelUrl: labelUrl ?? null,

    // Pickup — snapshot from vendor
    pickupVendorId: vendor?.id ?? null,
    pickupName: vendor?.name ?? null,
    pickupContact: vendor?.phone ?? null,
    pickupAddress: vendor?.address ?? null,
    pickupCity: vendor?.city ?? null,
    pickupState: vendor?.state ?? null,
    pickupPincode: vendor?.pincode ?? null,

    // Delivery — snapshot from order
    deliveryName: order.delivery_name,
    deliveryPhone: order.delivery_phone ?? null,
    deliveryAddress: order.delivery_address,
    deliveryCity: order.delivery_city ?? null,
    deliveryState: order.delivery_state ?? null,
    deliveryPincode: order.delivery_pincode,

    notes: note ?? null,
    createdBy: adminId,
  });

  // ── 5. Update order → READY_TO_SHIP ─────────────────────────────────────────
  const updated = await updateOrder(orderId, {
    status: "READY_TO_SHIP",
    status_changed_by: adminId,
    status_changed_at: now,
    status_note:
      note ?? `Shiprocket order created. AWB: ${awbCode ?? "pending"}`,
  });

  // ── 6. OrderStatusLog ────────────────────────────────────────────────────────
  await writeOrderStatusLog({
    orderId,
    fromStatus: "PRINT_COMPLETE",
    toStatus: "READY_TO_SHIP",
    changedBy: adminId,
    note: note ?? "Shiprocket order created — awaiting pickup",
    metadata: {
      shipment_id: shipment.id,
      shiprocket_order_id: shiprocketOrderId,
      awb_code: awbCode,
      courier: courierName,
      tracking_url: trackingUrl,
    },
  });

  writeAuditLog({
    actorId: adminId,
    actorType: "SUPER_ADMIN",
    schoolId: order.school_id,
    action: "SHIPMENT_CREATED",
    entity: "OrderShipment",
    entityId: shipment.id,
    newValue: {
      order_id: orderId,
      awb_code: awbCode,
      courier: courierName,
      tracking_url: trackingUrl,
    },
    ip,
  }).catch(() => {});

  return { order: updated, shipment };
};

// =============================================================================
// 8b. MARK SHIPPED
// Called by order.controller.js → PATCH /api/orders/:id/shipment/shipped
// =============================================================================

/**
 * Shiprocket picked up from vendor → status SHIPPED.
 *
 * @param {object} params
 * @param {string} params.orderId
 * @param {string} params.adminId
 * @param {string|null} params.trackingUrl
 * @param {string|null} params.note
 * @param {string} params.ip
 */
export const markShippedStep = async ({
  orderId,
  adminId,
  trackingUrl,
  note,
  ip,
}) => {
  const order = await findOrderByIdRaw(orderId);
  if (!order) throw new ApiError(404, "Order not found");

  assertValidTransition(order.status, "SHIPPED");

  const now = new Date();

  // BUG FIX [S8-2]: updateShipment now keys on order_id (see repo fix).
  await updateShipment(orderId, {
    status: "PICKED_UP",
    picked_up_at: now,
    tracking_url: trackingUrl ?? undefined,
    tracking_shared_at: now,
    tracking_shared_by: adminId,
    updated_at: now,
  });

  const updated = await updateOrder(orderId, {
    status: "SHIPPED",
    status_changed_by: adminId,
    status_changed_at: now,
    status_note: note ?? "Cards shipped — tracking shared with school",
  });

  await writeOrderStatusLog({
    orderId,
    fromStatus: "READY_TO_SHIP",
    toStatus: "SHIPPED",
    changedBy: adminId,
    note: note ?? "Cards picked up by courier — tracking shared",
    metadata: {
      tracking_url: trackingUrl,
      shipped_at: now,
    },
  });

  writeAuditLog({
    actorId: adminId,
    actorType: "SUPER_ADMIN",
    schoolId: order.school_id,
    action: "ORDER_SHIPPED",
    entity: "CardOrder",
    entityId: orderId,
    newValue: { status: "SHIPPED", shipped_at: now },
    ip,
  }).catch(() => {});

  return { order: updated };
};

// =============================================================================
// 8c. MARK DELIVERED
// Called by order.controller.js → PATCH /api/orders/:id/shipment/delivered
// =============================================================================

/**
 * Cards delivered to school → DELIVERED → BALANCE_PENDING.
 * All tokens → ISSUED. Balance due date set.
 *
 * @param {object} params
 * @param {string} params.orderId
 * @param {string} params.adminId
 * @param {string|null} params.note
 * @param {string} params.ip
 */
export const markDeliveredStep = async ({ orderId, adminId, note, ip }) => {
  const order = await findOrderByIdRaw(orderId);
  if (!order) throw new ApiError(404, "Order not found");

  assertValidTransition(order.status, "DELIVERED");

  const now = new Date();
  const balanceDueAt = calculateBalanceDueDate(now);

  // ── 1. Update shipment ────────────────────────────────────────────────────────
  // BUG FIX [S8-2]: keyed on orderId — repo updated to use order_id.
  await updateShipment(orderId, {
    status: "DELIVERED",
    delivered_at: now,
    delivery_confirmed_by: adminId,
    updated_at: now,
  });

  // ── 2. Mark all tokens ISSUED ─────────────────────────────────────────────────
  // BUG FIX [S8-3]: old code fetched tokenIds then called bulkUpdateTokenStatus(tokenIds, "ISSUED")
  // — passing an array as orderId. Fixed: pass orderId string directly.
  await bulkUpdateTokenStatus(orderId, "ISSUED");

  // ── 3. Update order → BALANCE_PENDING ────────────────────────────────────────
  const updated = await updateOrder(orderId, {
    status: "BALANCE_PENDING",
    balance_due_at: balanceDueAt,
    status_changed_by: adminId,
    status_changed_at: now,
    status_note: note ?? "Delivered — balance invoice pending",
  });

  // ── 4. Count tokens for response ─────────────────────────────────────────────
  const tokensIssued = order.tokens?.length ?? order.card_count;

  // ── 5. OrderStatusLog ────────────────────────────────────────────────────────
  await writeOrderStatusLog({
    orderId,
    fromStatus: "SHIPPED",
    toStatus: "DELIVERED",
    changedBy: adminId,
    note: "Cards delivered to school",
    metadata: { delivered_at: now, tokens_issued: tokensIssued },
  });

  await writeOrderStatusLog({
    orderId,
    fromStatus: "DELIVERED",
    toStatus: "BALANCE_PENDING",
    changedBy: adminId,
    note: `Balance invoice due by ${balanceDueAt.toDateString()}`,
    metadata: {
      balance_due_at: balanceDueAt,
      balance_amount: order.balance_amount,
    },
  });

  writeAuditLog({
    actorId: adminId,
    actorType: "SUPER_ADMIN",
    schoolId: order.school_id,
    action: "ORDER_DELIVERED",
    entity: "CardOrder",
    entityId: orderId,
    newValue: {
      status: "BALANCE_PENDING",
      delivered_at: now,
      tokens_issued: tokensIssued,
      balance_due_at: balanceDueAt,
    },
    ip,
  }).catch(() => {});

  return { order: updated, tokensIssued, balanceDueAt };
};
