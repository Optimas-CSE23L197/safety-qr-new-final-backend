// =============================================================================
// orchestrator/handlers/shipment.handler.js — RESQID PHASE 1
// Shipment creation + tracking update.
// =============================================================================

import { prisma } from '#config/prisma.js';
import { logger } from '#config/logger.js';
import { applyTransition } from '../state/order.guards.js';
import { ORDER_STATUS } from '../state/order.states.js';

export const handleShipmentCreate = async job => {
  const { orderId, schoolId, trackingId, trackingUrl, courier, actorId } = job.data?.payload ?? {};

  if (!orderId || !trackingId) {
    throw new Error('[shipment.handler] Missing orderId or trackingId');
  }

  logger.info({ jobId: job.id, orderId, trackingId }, '[shipment.handler] Creating shipment');

  const order = await prisma.cardOrder.findUnique({
    where: { id: orderId },
    select: { id: true, status: true, order_number: true },
  });

  if (!order) throw new Error(`[shipment.handler] Order not found: ${orderId}`);

  // Use OrderShipment model
  await prisma.orderShipment.upsert({
    where: { order_id: orderId },
    create: {
      order_id: orderId,
      awb_code: trackingId,
      tracking_url: trackingUrl ?? null,
      courier_name: courier ?? null,
      status: 'PICKED_UP',
      created_by: actorId ?? 'SYSTEM',
      created_at: new Date(),
    },
    update: {
      awb_code: trackingId,
      tracking_url: trackingUrl ?? null,
      courier_name: courier ?? null,
      status: 'PICKED_UP',
      updated_at: new Date(),
    },
  });

  await applyTransition({
    orderId,
    from: order.status,
    to: ORDER_STATUS.SHIPPED,
    actorId: actorId ?? 'SYSTEM',
    actorType: 'WORKER',
    schoolId,
    meta: { trackingId, courier },
    eventPayload: { orderNumber: order.order_number, trackingId, trackingUrl },
  });

  return { success: true, data: { orderId, trackingId, newStatus: ORDER_STATUS.SHIPPED } };
};

export const handleShipmentOutForDelivery = async job => {
  const { orderId, schoolId, actorId } = job.data?.payload ?? {};

  if (!orderId) throw new Error('[shipment.handler] orderId is required');

  logger.info({ jobId: job.id, orderId }, '[shipment.handler] Marking out for delivery');

  const order = await prisma.cardOrder.findUnique({
    where: { id: orderId },
    select: { id: true, status: true, order_number: true },
  });

  if (!order) throw new Error(`[shipment.handler] Order not found: ${orderId}`);

  await prisma.orderShipment.updateMany({
    where: { order_id: orderId },
    data: { status: 'OUT_FOR_DELIVERY', updated_at: new Date() },
  });

  await applyTransition({
    orderId,
    from: order.status,
    to: ORDER_STATUS.OUT_FOR_DELIVERY,
    actorId: actorId ?? 'SYSTEM',
    actorType: 'WORKER',
    schoolId,
    meta: {},
    eventPayload: { orderNumber: order.order_number },
  });

  return { success: true, data: { orderId, newStatus: ORDER_STATUS.OUT_FOR_DELIVERY } };
};
