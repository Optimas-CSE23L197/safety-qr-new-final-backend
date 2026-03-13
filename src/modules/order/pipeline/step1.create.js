// =============================================================================
// pipeline/step1.create.js — RESQID
// → PENDING
//
// Super admin creates a new card order for a school.
// Validates school + active subscription, calculates pricing, writes PENDING.
//
// BUG FIX [S1-1]: This file previously contained the CONFIRM step logic
// (PENDING → CONFIRMED) with export name `runConfirm`. The controller imports
// `createOrderStep` from this file — those never matched, causing a runtime
// crash on every POST /api/orders call. File is now the correct CREATE step.
// =============================================================================

import * as repo from "../order.repository.js";
import { writeAuditLog } from "../../../utils/helpers/auditLogger.js";
import { ApiError } from "../../../utils/response/ApiError.js";
// FIX [S1-1]: calculateOrderFinancials was imported but never used in this file.
// Pricing is calculated in step2 (confirm), not step1 (create). Removed.

// =============================================================================
// MAIN STEP
// =============================================================================

/**
 * Create a new card order.
 *
 * @param {object} params
 * @param {string} params.schoolId
 * @param {string} params.adminId
 * @param {string} params.channel        — "DASHBOARD" | "CALL"
 * @param {string} params.orderType      — "BLANK" | "PRE_DETAILS"
 * @param {number} params.cardCount
 * @param {object} params.delivery       — delivery address fields (partial OK for CALL)
 * @param {object} params.callContext    — { caller_name, caller_phone, call_notes }
 * @param {string} params.notes
 * @param {string} params.adminNotes
 * @param {string} params.ip
 */
export const createOrderStep = async ({
  schoolId,
  adminId,
  channel,
  orderType,
  cardCount,
  delivery = {},
  callContext = {},
  notes,
  adminNotes,
  ip,
}) => {
  // ── 1. Validate school ──────────────────────────────────────────────────────
  const school = await repo.findSchoolForOrder(schoolId);
  if (!school) throw ApiError.notFound("School not found");
  if (!school.is_active) {
    throw ApiError.forbidden(
      "School account is inactive — cannot create order",
    );
  }

  // ── 2. Validate active subscription ────────────────────────────────────────
  const subscription = school.subscriptions?.[0] ?? null;
  if (!subscription) {
    throw ApiError.badRequest(
      "School has no active subscription — cannot create order",
    );
  }

  // ── 3. DASHBOARD orders must have a complete delivery address ───────────────
  if (channel === "DASHBOARD") {
    const required = [
      "delivery_name",
      "delivery_phone",
      "delivery_address",
      "delivery_city",
      "delivery_state",
      "delivery_pincode",
    ];
    const missing = required.filter((f) => !delivery[f]);
    if (missing.length > 0) {
      throw ApiError.badRequest(
        `Missing required delivery fields for DASHBOARD order: ${missing.join(", ")}`,
      );
    }
  }

  // ── 4. Generate order number ────────────────────────────────────────────────
  const orderNumber = await repo.generateOrderNumber();

  // ── 5. Create order (+ initial status log in transaction) ──────────────────
  const order = await repo.createOrder({
    schoolId,
    subscriptionId: subscription.id,
    orderNumber,
    orderType,
    orderMode: "BULK",
    channel,
    cardCount,
    deliveryName: delivery.delivery_name ?? null,
    deliveryPhone: delivery.delivery_phone ?? null,
    deliveryAddress: delivery.delivery_address ?? null,
    deliveryCity: delivery.delivery_city ?? null,
    deliveryState: delivery.delivery_state ?? null,
    deliveryPincode: delivery.delivery_pincode ?? null,
    deliveryNotes: delivery.delivery_notes ?? null,
    callerName: callContext.caller_name ?? null,
    callerPhone: callContext.caller_phone ?? null,
    callNotes: callContext.call_notes ?? null,
    notes: notes ?? null,
    adminNotes: adminNotes ?? null,
    createdBy: adminId,
  });

  // ── 6. Audit (fire-and-forget) ──────────────────────────────────────────────
  writeAuditLog({
    actorId: adminId,
    actorType: "SUPER_ADMIN",
    schoolId,
    action: "ORDER_CREATED",
    entity: "CardOrder",
    entityId: order.id,
    newValue: {
      order_number: orderNumber,
      status: "PENDING",
      channel,
      order_type: orderType,
      card_count: cardCount,
      subscription_id: subscription.id,
    },
    ip,
  }).catch(() => {});

  return { order, orderNumber };
};
