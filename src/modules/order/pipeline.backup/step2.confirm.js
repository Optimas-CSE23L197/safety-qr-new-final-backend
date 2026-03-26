// =============================================================================
// pipeline/step2.confirm.js — RESQID (v2)
//
// FIXES IN THIS VERSION:
//   [F-1] Optimistic status lock: use updateMany({ where: { status: "PENDING" } })
//         so concurrent confirm attempts from two admins both read PENDING but
//         only one wins the update — the loser gets count === 0 → conflict error.
// =============================================================================

import * as repo from "../order.repository.js";
import { writeAuditLog } from "../../../utils/helpers/auditLogger.js";
import { ApiError } from "../../../utils/response/ApiError.js";
import { calculateOrderFinancials } from "../order.helpers.js";
import { prisma } from "../../../config/prisma.js";

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

  if (order.status !== "PENDING") {
    throw ApiError.badRequest(
      `Cannot confirm order in status: ${order.status}. Expected: PENDING`,
    );
  }

  if (!order.school?.is_active) {
    throw ApiError.forbidden(
      "School account is inactive — cannot confirm order",
    );
  }

  if (!order.subscription) {
    throw ApiError.badRequest(
      "School has no active subscription — cannot confirm order",
    );
  }

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

  const pricingTier = order.subscription.pricing_tier ?? "PRIVATE_STANDARD";

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

  // ── [F-1] Optimistic lock — wins or throws ───────────────────────────────
  const lockResult = await prisma.cardOrder.updateMany({
    where: { id: orderId, status: "PENDING" },
    data: {
      status: "CONFIRMED",
      confirmed_by: adminId,
      confirmed_at: new Date(),
      advance_amount: advanceAmount,
      balance_amount: balanceAmount,
      delivery_name: delivery.delivery_name ?? undefined,
      delivery_phone: delivery.delivery_phone ?? undefined,
      delivery_address: delivery.delivery_address ?? undefined,
      delivery_city: delivery.delivery_city ?? undefined,
      delivery_state: delivery.delivery_state ?? undefined,
      delivery_pincode: delivery.delivery_pincode ?? undefined,
      delivery_notes: delivery.delivery_notes ?? undefined,
      status_changed_by: adminId,
      status_changed_at: new Date(),
    },
  });

  if (lockResult.count === 0) {
    throw ApiError.conflict(
      "Order was already confirmed or status changed — reload and try again",
    );
  }

  // Re-fetch to get full updated row for the response
  const updated = await repo.findOrderById(orderId);

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
