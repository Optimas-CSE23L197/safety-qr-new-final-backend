// =============================================================================
// pipeline/step7.printing.js — RESQID
// SENT_TO_VENDOR → PRINTING → PRINT_COMPLETE
//
// Two sub-actions:
//   7a. markPrintingStep()      — vendor started printing → PRINTING
//   7b. markPrintCompleteStep() — vendor finished → PRINT_COMPLETE
//
// BUG FIX [S7-1]: bulkUpdateCardPrintStatus(orderId, "PRINTED") was passing
// "PRINTED" as a second positional arg, but the old repo function only accepted
// orderId — the status arg was silently ignored. Card.print_status was never
// updated from PENDING to PRINTED. Fixed in repo to accept the status param.
//
// BUG FIX [S7-2]: writeAuditLog was called with { actorId, actorType, schoolId,
// newValue } but old repo expected { userId, role, metadata }. Fixed.
// =============================================================================

import {
  findOrderByIdRaw,
  updateOrder,
  bulkUpdateCardPrintStatus,
  bulkUpdateOrderItemsPrinted,
  writeOrderStatusLog,
} from "../order.repository.js";

// FIX [A-1]: unified auditLogger — see step5 comment.
import { writeAuditLog } from "../../../utils/helpers/auditLogger.js";

import { assertValidTransition } from "../order.helpers.js";
import { ApiError } from "../../../utils/response/ApiError.js";

// =============================================================================
// 7a. MARK PRINTING STARTED
// Called by order.controller.js → PATCH /api/orders/:id/printing/start
// =============================================================================

/**
 * Vendor confirmed printing started → status PRINTING.
 *
 * @param {object} params
 * @param {string} params.orderId
 * @param {string} params.adminId
 * @param {string|null} params.note
 * @param {string} params.ip
 */
export const markPrintingStep = async ({ orderId, adminId, note, ip }) => {
  const order = await findOrderByIdRaw(orderId);
  if (!order) throw new ApiError(404, "Order not found");

  assertValidTransition(order.status, "PRINTING");

  const now = new Date();

  const updated = await updateOrder(orderId, {
    status: "PRINTING",
    status_changed_by: adminId,
    status_changed_at: now,
    status_note: note ?? "Vendor confirmed printing in progress",
  });

  await writeOrderStatusLog({
    orderId,
    fromStatus: "SENT_TO_VENDOR",
    toStatus: "PRINTING",
    changedBy: adminId,
    note: note ?? "Vendor confirmed printing started",
    metadata: { marked_by: adminId, at: now },
  });

  writeAuditLog({
    actorId: adminId,
    actorType: "SUPER_ADMIN",
    schoolId: order.school_id,
    action: "PRINTING_STARTED",
    entity: "CardOrder",
    entityId: orderId,
    newValue: { status: "PRINTING" },
    ip,
  }).catch(() => {});

  return { order: updated };
};

// =============================================================================
// 7b. MARK PRINT COMPLETE
// Called by order.controller.js → PATCH /api/orders/:id/printing/complete
// =============================================================================

/**
 * Vendor finished printing all cards → status PRINT_COMPLETE.
 * Updates Card.print_status → PRINTED for all cards in order.
 * Updates CardOrderItem.card_printed → true (PRE_DETAILS only).
 *
 * @param {object} params
 * @param {string} params.orderId
 * @param {string} params.adminId
 * @param {string|null} params.note
 * @param {string} params.ip
 */
export const markPrintCompleteStep = async ({ orderId, adminId, note, ip }) => {
  const order = await findOrderByIdRaw(orderId);
  if (!order) throw new ApiError(404, "Order not found");

  assertValidTransition(order.status, "PRINT_COMPLETE");

  const now = new Date();

  // BUG FIX [S7-1]: Pass explicit "PRINTED" status — repo now uses it correctly.
  await bulkUpdateCardPrintStatus(orderId, "PRINTED");

  if (order.order_type === "PRE_DETAILS") {
    await bulkUpdateOrderItemsPrinted(orderId);
  }

  const updated = await updateOrder(orderId, {
    status: "PRINT_COMPLETE",
    print_complete_at: now,
    print_complete_noted_by: adminId,
    status_changed_by: adminId,
    status_changed_at: now,
    status_note: note ?? "All cards printed and verified by vendor",
  });

  await writeOrderStatusLog({
    orderId,
    fromStatus: "PRINTING",
    toStatus: "PRINT_COMPLETE",
    changedBy: adminId,
    note: note ?? "Vendor confirmed all cards printed",
    metadata: {
      card_count: order.card_count,
      completed_at: now,
    },
  });

  writeAuditLog({
    actorId: adminId,
    actorType: "SUPER_ADMIN",
    schoolId: order.school_id,
    action: "PRINT_COMPLETE",
    entity: "CardOrder",
    entityId: orderId,
    newValue: {
      status: "PRINT_COMPLETE",
      card_count: order.card_count,
      completed_at: now,
    },
    ip,
  }).catch(() => {});

  return { order: updated };
};
