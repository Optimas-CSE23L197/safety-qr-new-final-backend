// =============================================================================
// pipeline/step5.design.js — RESQID (v2)
//
// FIXES IN THIS VERSION:
//   [F-1] Batch card updateMany: instead of 1500 individual updateCard calls,
//         group cards by fileUrl and use updateMany — collapses to 1-2 queries.
//         For stub engine (fileUrl=null) this is always 1 query.
//         This prevents the 30-second HTTP timeout on large orders.
//   [F-2] Order items batch update: same pattern for cardOrderItem rows.
// =============================================================================

import {
  findOrderByIdRaw,
  findSchoolForOrder,
  findCardTemplateForSchool,
  findDefaultCardTemplate,
  updateOrder,
  writeOrderStatusLog,
  findOrderItems,
} from "../order.repository.js";

import { writeAuditLog } from "../../../utils/helpers/auditLogger.js";
import { uploadFile } from "../../../services/storage/storage.service.js";
import { assertValidTransition } from "../order.helpers.js";
import { ApiError } from "../../../utils/response/ApiError.js";
import { prisma } from "../../../config/prisma.js";

const designEngineEnabled = () => process.env.CARD_DESIGN_ENGINE === "real";

const composeCardDesign = async ({ template, qrAsset, item, cardNumber }) => {
  if (!designEngineEnabled()) return null;
  throw new Error(
    "CARD_DESIGN_ENGINE=real but design service not yet implemented",
  );
};

export const generateCardDesignStep = async ({
  orderId,
  adminId,
  note,
  ip,
}) => {
  const order = await findOrderByIdRaw(orderId);
  if (!order) throw new ApiError(404, "Order not found");

  assertValidTransition(order.status, "CARD_DESIGN");

  const [school, template] = await Promise.all([
    findSchoolForOrder(order.school_id),
    findCardTemplateForSchool(order.school_id).then(
      (t) => t ?? findDefaultCardTemplate(),
    ),
  ]);

  if (!school) throw new ApiError(404, "School not found");

  await updateOrder(orderId, {
    status: "CARD_DESIGN",
    status_changed_by: adminId,
    status_changed_at: new Date(),
  });

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

  const qrByTokenId = Object.fromEntries(qrAssets.map((q) => [q.token_id, q]));
  const itemByTokenId = Object.fromEntries(
    orderItems.map((it) => [it.token_id, it]),
  );

  // [F-1] Build a map of fileUrl → cardIds instead of updating one by one
  // For stub engine all fileUrls are null, so this is a single updateMany.
  // For real engine, group cards with the same output URL (batched uploads).
  const fileUrlToCardIds = new Map();
  const fileUrlToItemIds = new Map();
  let designedCount = 0;

  for (const card of cards) {
    const qrAsset = qrByTokenId[card.token_id];
    const item = itemByTokenId[card.token_id] ?? null;

    const buffer = await composeCardDesign({
      template,
      qrAsset,
      item,
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

    if (!fileUrlToCardIds.has(fileUrl)) fileUrlToCardIds.set(fileUrl, []);
    fileUrlToCardIds.get(fileUrl).push(card.id);

    if (item) {
      if (!fileUrlToItemIds.has(fileUrl)) fileUrlToItemIds.set(fileUrl, []);
      fileUrlToItemIds.get(fileUrl).push(item.id);
    }

    designedCount++;
  }

  // [F-1] Batch update cards — 1 query per unique fileUrl (usually 1 total for stub)
  for (const [fileUrl, cardIds] of fileUrlToCardIds) {
    await prisma.card.updateMany({
      where: { id: { in: cardIds } },
      data: { file_url: fileUrl },
    });
  }

  // [F-2] Batch update order items
  for (const [fileUrl, itemIds] of fileUrlToItemIds) {
    await prisma.cardOrderItem.updateMany({
      where: { id: { in: itemIds } },
      data: { status: "CARD_DESIGNED", card_design_url: fileUrl ?? null },
    });
  }

  const cardDesignFiles = {
    engine: designEngineEnabled() ? "real" : "stub",
    designed_count: designedCount,
    pdf_url: null,
    sheet_url: null,
    preview_url: null,
    generated_at: new Date().toISOString(),
  };

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

export const retryCardDesignStep = async ({ orderId, adminId, note, ip }) => {
  const order = await findOrderByIdRaw(orderId);
  if (!order) throw new ApiError(404, "Order not found");

  assertValidTransition(order.status, "CARD_DESIGN");

  return generateCardDesignStep({ orderId, adminId, note, ip });
};
