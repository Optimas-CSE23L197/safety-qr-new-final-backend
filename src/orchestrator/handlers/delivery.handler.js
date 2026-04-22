// =============================================================================
// orchestrator/handlers/delivery.handler.js — RESQID PHASE 1
// Mark order delivered + trigger balance invoice.
// =============================================================================

import { prisma } from '#config/prisma.js';
import { logger } from '#config/logger.js';
import { applyTransition } from '../state/order.guards.js';
import { ORDER_STATUS } from '../state/order.states.js';
import { generateOrderInvoice } from '../jobs/invoice.job.js';

export const handleDelivery = async job => {
  const { orderId, schoolId, actorId, deliveredAt } = job.data?.payload ?? {};

  if (!orderId) throw new Error('[delivery.handler] orderId is required');

  logger.info({ jobId: job.id, orderId }, '[delivery.handler] Marking order delivered');

  const order = await prisma.cardOrder.findUnique({
    where: { id: orderId },
    select: { id: true, status: true, order_number: true, balance_amount: true },
  });

  if (!order) throw new Error(`[delivery.handler] Order not found: ${orderId}`);

  await prisma.cardOrder.update({
    where: { id: orderId },
    data: {
      status_changed_at: new Date(),
      status_note: `Delivered at ${deliveredAt || new Date().toISOString()}`,
    },
  });

  // Update OrderShipment model
  await prisma.orderShipment.updateMany({
    where: { order_id: orderId },
    data: {
      status: 'DELIVERED',
      delivered_at: deliveredAt ? new Date(deliveredAt) : new Date(),
      updated_at: new Date(),
    },
  });

  await applyTransition({
    orderId,
    from: order.status,
    to: ORDER_STATUS.DELIVERED,
    actorId: actorId ?? 'SYSTEM',
    actorType: 'WORKER',
    schoolId,
    meta: {},
    eventPayload: { orderNumber: order.order_number },
  });

  // Generate balance invoice directly — no queue
  await generateOrderInvoice(orderId);

  logger.info({ orderId }, '[delivery.handler] Delivery recorded and invoice generated');

  return {
    success: true,
    data: { orderId, newStatus: ORDER_STATUS.DELIVERED },
  };
};
