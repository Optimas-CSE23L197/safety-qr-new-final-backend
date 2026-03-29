// =============================================================================
// orchestrator/handlers/cancel.handler.js — RESQID PHASE 1
// Order cancellation + refund trigger.
// =============================================================================

import { prisma } from '#config/prisma.js';
import { logger } from '#config/logger.js';
import { applyTransition } from '../state/order.guards.js';
import { ORDER_STATUS } from '../state/order.states.js';
import { backgroundJobsQueue } from '../queues/queue.config.js';

export const handleCancellation = async job => {
  const { orderId, schoolId, actorId, reason, triggerRefund = false } = job.data?.payload ?? {};

  if (!orderId) throw new Error('[cancel.handler] orderId is required');

  logger.info({ jobId: job.id, orderId, reason }, '[cancel.handler] Processing cancellation');

  const order = await prisma.cardOrder.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      status: true,
      order_number: true,
      payment_status: true,
      advance_amount: true,
      payments: {
        where: { status: 'SUCCESS' },
        select: { id: true, amount: true },
        take: 1,
      },
    },
  });

  if (!order) throw new Error(`[cancel.handler] Order not found: ${orderId}`);

  await prisma.cardOrder.update({
    where: { id: orderId },
    data: {
      status_note: reason ?? null,
      status_changed_at: new Date(),
      status_changed_by: actorId ?? 'SYSTEM',
    },
  });

  await applyTransition({
    orderId,
    from: order.status,
    to: ORDER_STATUS.CANCELLED,
    actorId: actorId ?? 'SYSTEM',
    actorType: actorId ? 'ADMIN' : 'SYSTEM',
    schoolId,
    meta: { reason },
    eventPayload: { orderNumber: order.order_number, reason },
  });

  // Phase 1: Refund is manual — just log
  if (triggerRefund && order.payments?.[0]) {
    logger.info(
      { orderId, paymentId: order.payments[0].id, amount: order.payments[0].amount },
      '[cancel.handler] Refund required — manual processing'
    );
  }

  return {
    success: true,
    data: {
      orderId,
      newStatus: ORDER_STATUS.CANCELLED,
    },
  };
};
