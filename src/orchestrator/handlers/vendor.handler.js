// =============================================================================
// orchestrator/handlers/vendor.handler.js — RESQID PHASE 1
// Vendor assignment placeholder (Phase 1: manual)
// =============================================================================

import { prisma } from '#config/prisma.js';
import { logger } from '#config/logger.js';
import { applyTransition } from '../state/order.guards.js';
import { ORDER_STATUS } from '../state/order.states.js';

export const handleVendorAssignment = async job => {
  const { orderId, vendorId, schoolId, actorId } = job.data?.payload ?? {};

  if (!orderId) {
    throw new Error('[vendor.handler] orderId is required');
  }

  logger.info(
    { jobId: job.id, orderId, vendorId },
    '[vendor.handler] Vendor assignment (Phase 1 placeholder)'
  );

  const order = await prisma.cardOrder.findUnique({
    where: { id: orderId },
    select: { id: true, status: true, order_number: true },
  });

  if (!order) throw new Error(`[vendor.handler] Order not found: ${orderId}`);

  // Phase 1: Just update order with vendor info
  if (vendorId) {
    await prisma.cardOrder.update({
      where: { id: orderId },
      data: {
        vendor_id: vendorId,
        files_sent_to_vendor_at: new Date(),
        files_sent_by: actorId ?? 'SYSTEM',
      },
    });
  }

  await applyTransition({
    orderId,
    from: order.status,
    to: ORDER_STATUS.VENDOR_SENT,
    actorId: actorId ?? 'SYSTEM',
    actorType: 'WORKER',
    schoolId,
    meta: { vendorId: vendorId || 'manual' },
    eventPayload: { orderNumber: order.order_number },
  });

  logger.info({ orderId, vendorId }, '[vendor.handler] Order marked as sent to vendor');

  return {
    success: true,
    data: { orderId, newStatus: ORDER_STATUS.VENDOR_SENT },
  };
};
