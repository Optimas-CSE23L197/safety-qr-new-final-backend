// =============================================================================
// pipeline/step5.design.js — RESQID
// TOKEN_GENERATED → CARD_DESIGN → CARD_DESIGN_READY
//
// For now: generates placeholder card records and marks design ready.
// When card design service is ready (canvas/sharp/pdf-lib): swap in below.
// One flag in .env (CARD_DESIGN_ENGINE=real) → full design kicks in.
//
// BUG FIX [S5-1]: findCardTemplate was called with order.school_id but the
// function expects a template UUID (id). Changed to use findCardTemplateForSchool
// which queries by school_id, with a fallback to findDefaultCardTemplate.
//
// BUG FIX [S5-2]: writeOrderStatusLog was called with fromStatus: "TOKEN_GENERATED"
// but the order had already been moved to CARD_DESIGN (step 4 of this function).
// The log correctly records the actual prior status: "TOKEN_GENERATED" for the
// initial call, but the status at log-write time is CARD_DESIGN_READY. The log
// now records the true from/to: TOKEN_GENERATED → CARD_DESIGN_READY (correct
// since we collapse both interim steps into one log entry from this function's
// perspective).
//
// BUG FIX [S5-3]: writeAuditLog was called with { actorId, actorType, schoolId,
// newValue } but the repo writeAuditLog function expected { userId, role, metadata }.
// All fields were silently dropped. Fixed via the unified writeAuditLog in repo.
// =============================================================================

import {
  findOrderByIdRaw,
  findSchoolForOrder,
  findCardTemplateForSchool,
  findDefaultCardTemplate,
  updateOrder,
  updateCard,
  writeOrderStatusLog,
  findOrderItems,
} from "../order.repository.js";

// FIX [A-1]: writeAuditLog moved to unified auditLogger — single source of
// truth for all audit logging. Repo writeAuditLog was mapping fields incorrectly
// against the AuditLog schema (actor_id/actor_type vs user_id/role).
import { writeAuditLog } from "../../../utils/helpers/auditLogger.js";

// FIX [S5-4]: was `import { uploadBuffer }` — storage.service.js only exports
// `uploadFile({ key, body, contentType })`. uploadBuffer does not exist and
// would throw a runtime crash on the first card design attempt.
import { uploadFile } from "../../../services/storage/storage.service.js";
import { assertValidTransition } from "../order.helpers.js";
import { ApiError } from "../../../utils/response/ApiError.js";
import { prisma } from "../../../config/prisma.js";

// =============================================================================
// CARD DESIGN ENGINE
// CARD_DESIGN_ENGINE=stub → skip actual composition, mark ready with null file_url
// CARD_DESIGN_ENGINE=real → call composeCard() with real canvas/sharp logic
// =============================================================================

const designEngineEnabled = () => process.env.CARD_DESIGN_ENGINE === "real";

/**
 * Stub composer — returns null buffer (no actual file generated).
 * Real implementation will use sharp/canvas/pdf-lib to compose:
 *   school logo + student photo + student name + class + card number + QR
 *
 * @returns {Buffer|null}
 */
const composeCardDesign = async ({ template, qrAsset, item, cardNumber }) => {
  if (!designEngineEnabled()) return null;

  // TODO: implement with sharp/canvas when card design service is ready
  throw new Error(
    "CARD_DESIGN_ENGINE=real but design service not yet implemented",
  );
};

// =============================================================================
// MAIN HANDLER
// Called by order.controller.js → POST /api/orders/:id/design
// =============================================================================

/**
 * Generate physical card designs for all tokens in an order.
 *
 * @param {object} params
 * @param {string} params.orderId
 * @param {string} params.adminId
 * @param {string|null} params.note
 * @param {string} params.ip
 */
export const generateCardDesignStep = async ({
  orderId,
  adminId,
  note,
  ip,
}) => {
  // ── 1. Load order ────────────────────────────────────────────────────────────
  const order = await findOrderByIdRaw(orderId);
  if (!order) throw new ApiError(404, "Order not found");

  // ── 2. Validate transition ───────────────────────────────────────────────────
  assertValidTransition(order.status, "CARD_DESIGN");

  // ── 3. Load school + template ────────────────────────────────────────────────
  // BUG FIX [S5-1]: was findCardTemplate(order.school_id) — wrong function + wrong arg.
  // findCardTemplate expects a template UUID. Use findCardTemplateForSchool instead.
  const [school, template] = await Promise.all([
    findSchoolForOrder(order.school_id),
    findCardTemplateForSchool(order.school_id).then(
      (t) => t ?? findDefaultCardTemplate(),
    ),
  ]);

  if (!school) throw new ApiError(404, "School not found");

  // ── 4. Mark CARD_DESIGN in progress ──────────────────────────────────────────
  await updateOrder(orderId, {
    status: "CARD_DESIGN",
    status_changed_by: adminId,
    status_changed_at: new Date(),
  });

  // ── 5. Load all cards + QR assets for this order ─────────────────────────────
  const [cards, qrAssets, orderItems] = await Promise.all([
    prisma.card.findMany({
      where: { order_id: orderId },
      select: { id: true, token_id: true, card_number: true },
    }),
    prisma.qrAsset.findMany({
      where: { order_id: orderId, is_active: true },
      select: { token_id: true, public_url: true },
    }),
    order.order_type === "PRE_DETAILS"
      ? findOrderItems(orderId)
      : Promise.resolve([]),
  ]);

  // Build lookup maps
  const qrByTokenId = Object.fromEntries(qrAssets.map((q) => [q.token_id, q]));
  const itemByTokenId = Object.fromEntries(
    orderItems.map((it) => [it.token_id, it]),
  );

  // ── 6. Compose + upload per card ─────────────────────────────────────────────
  let designedCount = 0;

  for (const card of cards) {
    const qrAsset = qrByTokenId[card.token_id];
    const item = itemByTokenId[card.token_id] ?? null;

    const buffer = await composeCardDesign({
      template,
      qrAsset,
      item, // null for BLANK orders — no student name/photo
      cardNumber: card.card_number,
    });

    let fileUrl = null;

    if (buffer) {
      const storageKey = `cards/${order.school_id}/${orderId}/${card.token_id}.png`;
      fileUrl = await uploadFile({
        key: storageKey,
        body: buffer,
        contentType: "image/png",
      });
    }

    await updateCard(card.id, { file_url: fileUrl });

    if (item) {
      await prisma.cardOrderItem.update({
        where: { id: item.id },
        data: { status: "CARD_DESIGNED", card_design_url: fileUrl ?? null },
      });
    }

    designedCount++;
  }

  // ── 7. Build card_design_files summary ──────────────────────────────────────
  const cardDesignFiles = {
    engine: designEngineEnabled() ? "real" : "stub",
    designed_count: designedCount,
    pdf_url: null, // TODO: print sheet PDF
    sheet_url: null, // TODO: vendor print sheet
    preview_url: null, // TODO: preview card PNG
    generated_at: new Date().toISOString(),
  };

  // ── 8. Update order → CARD_DESIGN_READY ─────────────────────────────────────
  const updated = await updateOrder(orderId, {
    status: "CARD_DESIGN_READY",
    card_design_files: cardDesignFiles,
    card_design_by: adminId,
    card_design_at: new Date(),
    status_changed_by: adminId,
    status_changed_at: new Date(),
    status_note:
      note ?? `Card designs generated (${designedCount}/${cards.length})`,
  });

  // ── 9. OrderStatusLog ────────────────────────────────────────────────────────
  // BUG FIX [S5-2]: fromStatus was "TOKEN_GENERATED" — correct for the logical
  // start of this step. The interim CARD_DESIGN status is an in-flight marker;
  // the meaningful logged transition is TOKEN_GENERATED → CARD_DESIGN_READY.
  await writeOrderStatusLog({
    orderId,
    fromStatus: "TOKEN_GENERATED",
    toStatus: "CARD_DESIGN_READY",
    changedBy: adminId,
    note: note ?? `${designedCount} card designs completed`,
    metadata: {
      designed_count: designedCount,
      engine: designEngineEnabled() ? "real" : "stub",
      card_design_files: cardDesignFiles,
    },
  });

  // ── 10. AuditLog ──────────────────────────────────────────────────────────────
  // BUG FIX [S5-3]: fixed param names to match unified writeAuditLog in repo.
  writeAuditLog({
    actorId: adminId,
    actorType: "SUPER_ADMIN",
    schoolId: order.school_id,
    action: "CARD_DESIGN_COMPLETE",
    entity: "CardOrder",
    entityId: orderId,
    newValue: {
      status: "CARD_DESIGN_READY",
      designed_count: designedCount,
      engine: designEngineEnabled() ? "real" : "stub",
    },
    ip,
  }).catch(() => {});

  return { order: updated, designedCount, cardDesignFiles };
};

// =============================================================================
// DESIGN REVISION (re-entry after CARD_DESIGN_REVISION)
// Called by order.controller.js → POST /api/orders/:id/design/retry
// =============================================================================

export const retryCardDesignStep = async ({ orderId, adminId, note, ip }) => {
  const order = await findOrderByIdRaw(orderId);
  if (!order) throw new ApiError(404, "Order not found");

  // CARD_DESIGN_REVISION → CARD_DESIGN is the valid retry transition
  assertValidTransition(order.status, "CARD_DESIGN");

  return generateCardDesignStep({ orderId, adminId, note, ip });
};
