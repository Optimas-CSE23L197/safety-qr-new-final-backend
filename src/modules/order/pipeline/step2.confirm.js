// =============================================================================
// pipeline/step2.confirm.js — RESQID
// PENDING → CONFIRMED
//
// Super admin reviews order, fills any missing delivery address (CALL orders),
// calculates pricing, sets advance/balance split.
//
// BUG FIX [S2-1]: This file previously contained PAYMENT step logic
// (CONFIRMED → PAYMENT_PENDING → ADVANCE_RECEIVED) with exports runSendInvoice
// and runMarkAdvancePaid. The controller imports `confirmOrderStep` — those
// never matched, causing a runtime crash on every PATCH /api/orders/:id/confirm.
// File is now the correct CONFIRM step.
// =============================================================================

import * as repo from "../order.repository.js";
import { writeAuditLog } from "../../../utils/helpers/auditLogger.js";
import { ApiError } from "../../../utils/response/ApiError.js";
import { calculateOrderFinancials } from "../order.helpers.js";

// =============================================================================
// MAIN STEP
// =============================================================================

/**
 * Confirm an order (PENDING → CONFIRMED).
 *
 * @param {object} params
 * @param {string} params.orderId
 * @param {string} params.adminId
 * @param {object} params.delivery        — optional delivery address updates
 * @param {number|null} params.customUnitPrice — paise, ENTERPRISE override
 * @param {string|null} params.note
 * @param {string} params.ip
 */
export const confirmOrderStep = async ({
  orderId,
  adminId,
  delivery = {},
  customUnitPrice = null,
  note,
  ip,
}) => {
  // ── 1. Fetch order ──────────────────────────────────────────────────────────
  const order = await repo.findOrderById(orderId);
  if (!order) throw ApiError.notFound("Order not found");

  // ── 2. Guard transition ─────────────────────────────────────────────────────
  if (order.status !== "PENDING") {
    throw ApiError.badRequest(
      `Cannot confirm order in status: ${order.status}. Expected: PENDING`,
    );
  }

  // ── 3. Validate school still active ─────────────────────────────────────────
  if (!order.school?.is_active) {
    throw ApiError.forbidden(
      "School account is inactive — cannot confirm order",
    );
  }

  // ── 4. Validate subscription exists ─────────────────────────────────────────
  if (!order.subscription) {
    throw ApiError.badRequest(
      "School has no active subscription — cannot confirm order",
    );
  }

  // ── 5. For CALL orders, delivery address must be complete by confirm time ────
  if (order.channel === "CALL") {
    const addr = delivery.delivery_address ?? order.delivery_address;
    const city = delivery.delivery_city ?? order.delivery_city;
    const pincode = delivery.delivery_pincode ?? order.delivery_pincode;
    if (!addr || !city || !pincode) {
      throw ApiError.badRequest(
        "CALL orders require delivery address, city, and pincode before confirmation",
      );
    }
  }

  // ── 6. Calculate pricing ────────────────────────────────────────────────────
  const pricingTier = order.subscription.pricing_tier ?? "PRIVATE_STANDARD";

  // SEC: custom_unit_price override is ENTERPRISE-only.
  // Reject the override for any other tier to prevent pricing bypass.
  if (customUnitPrice !== null && pricingTier !== "ENTERPRISE") {
    throw ApiError.forbidden(
      `custom_unit_price override is only permitted for ENTERPRISE subscriptions (current tier: ${pricingTier})`,
    );
  }

  const { advanceAmount, balanceAmount } = calculateOrderFinancials(
    pricingTier,
    order.card_count,
    customUnitPrice,
  );

  // ── 7. Update order → CONFIRMED ─────────────────────────────────────────────
  const updated = await repo.confirmOrder({
    orderId,
    adminId,
    advanceAmount,
    balanceAmount,
    deliveryName: delivery.delivery_name ?? undefined,
    deliveryPhone: delivery.delivery_phone ?? undefined,
    deliveryAddress: delivery.delivery_address ?? undefined,
    deliveryCity: delivery.delivery_city ?? undefined,
    deliveryState: delivery.delivery_state ?? undefined,
    deliveryPincode: delivery.delivery_pincode ?? undefined,
    deliveryNotes: delivery.delivery_notes ?? undefined,
  });

  // ── 8. OrderStatusLog ───────────────────────────────────────────────────────
  await repo.writeStatusLog({
    orderId,
    fromStatus: "PENDING",
    toStatus: "CONFIRMED",
    changedBy: adminId,
    note: note ?? "Order confirmed by super admin",
    metadata: {
      advance_amount_paise: advanceAmount,
      balance_amount_paise: balanceAmount,
      card_count: order.card_count,
    },
  });

  // ── 9. Audit (fire-and-forget) ───────────────────────────────────────────────
  writeAuditLog({
    actorId: adminId,
    actorType: "SUPER_ADMIN",
    schoolId: order.school_id,
    action: "ORDER_CONFIRMED",
    entity: "CardOrder",
    entityId: orderId,
    newValue: {
      status: "CONFIRMED",
      advance_amount: advanceAmount,
      balance_amount: balanceAmount,
    },
    ip,
  }).catch(() => {});

  return { order: updated };
};
