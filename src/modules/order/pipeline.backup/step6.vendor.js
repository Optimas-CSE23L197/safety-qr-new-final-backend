// =============================================================================
// pipeline/step6.vendor.js — RESQID
// CARD_DESIGN_READY → SENT_TO_VENDOR
//
// Mark design files sent to vendor + assign vendor to order.
//
// BUG FIX [S6-1]: writeAuditLog was called with { actorId, actorType, schoolId,
// newValue } but the old repo function expected { userId, role, metadata }.
// Fixed via the unified writeAuditLog in repo.
// =============================================================================

import {
  findOrderByIdRaw,
  findVendorById,
  updateOrder,
  writeOrderStatusLog,
} from "../order.repository.js";

// FIX [A-1]: unified auditLogger — see step5 comment.
import { writeAuditLog } from "../../../utils/helpers/auditLogger.js";

import { assertValidTransition } from "../order.helpers.js";
import { ApiError } from "../../../utils/response/ApiError.js";

// =============================================================================
// MAIN HANDLER
// Called by order.controller.js → PATCH /api/orders/:id/vendor
// =============================================================================

/**
 * Assign vendor + mark design files sent to printer.
 *
 * @param {object} params
 * @param {string} params.orderId
 * @param {string} params.adminId
 * @param {string} params.vendorId         — VendorProfile.id
 * @param {string|null} params.vendorNotes — card specs, finish, quantity, etc.
 * @param {string|null} params.note
 * @param {string} params.ip
 */
export const sendToVendorStep = async ({
  orderId,
  adminId,
  vendorId,
  vendorNotes,
  note,
  ip,
}) => {
  // ── 1. Load order ────────────────────────────────────────────────────────────
  const order = await findOrderByIdRaw(orderId);
  if (!order) throw new ApiError(404, "Order not found");

  // ── 2. Validate transition ───────────────────────────────────────────────────
  assertValidTransition(order.status, "SENT_TO_VENDOR");

  // ── 3. Validate vendor ───────────────────────────────────────────────────────
  const vendor = await findVendorById(vendorId);
  if (!vendor) throw new ApiError(404, "Vendor not found");
  if (vendor.status !== "ACTIVE")
    throw new ApiError(400, "Vendor is not active");

  const now = new Date();

  // ── 4. Update order ──────────────────────────────────────────────────────────
  const updated = await updateOrder(orderId, {
    status: "SENT_TO_VENDOR",
    vendor_id: vendorId,
    vendor_notes: vendorNotes ?? null,
    files_sent_to_vendor_at: now,
    files_sent_by: adminId,
    status_changed_by: adminId,
    status_changed_at: now,
    status_note: note ?? `Files sent to ${vendor.name}`,
  });

  // ── 5. OrderStatusLog ────────────────────────────────────────────────────────
  await writeOrderStatusLog({
    orderId,
    fromStatus: "CARD_DESIGN_READY",
    toStatus: "SENT_TO_VENDOR",
    changedBy: adminId,
    note: note ?? `Design files sent to vendor ${vendor.name}`,
    metadata: {
      vendor_id: vendorId,
      vendor_name: vendor.name,
      vendor_email: vendor.email,
      vendor_phone: vendor.phone,
      vendor_notes: vendorNotes,
      sent_at: now,
    },
  });

  // ── 6. AuditLog ──────────────────────────────────────────────────────────────
  writeAuditLog({
    actorId: adminId,
    actorType: "SUPER_ADMIN",
    schoolId: order.school_id,
    action: "FILES_SENT_TO_VENDOR",
    entity: "CardOrder",
    entityId: orderId,
    newValue: {
      status: "SENT_TO_VENDOR",
      vendor_id: vendorId,
      vendor_name: vendor.name,
      sent_at: now,
    },
    ip,
  }).catch(() => {});

  return { order: updated, vendor };
};
