// =============================================================================
// orchestrator/handlers/completion.handler.js — RESQID PHASE 1
// Order completion and finalization.
// =============================================================================

import { prisma } from '#config/prisma.js';
import { logger } from '#config/logger.js';
import { applyTransition } from '../state/order.guards.js';
import { ORDER_STATUS } from '../state/order.states.js';
import { generateOrderInvoice } from '../jobs/invoice.job.js';

export async function finalizeOrder(orderId, finalizedBy, notes = '') {
  const order = await prisma.cardOrder.findUnique({
    where: { id: orderId },
    include: { subscription: true, payments: true },
  });

  if (!order) throw new Error(`Order ${orderId} not found`);
  if (order.status !== 'DELIVERED') {
    throw new Error(`Order ${orderId} must be in DELIVERED state (got ${order.status})`);
  }

  const totalPaid = order.payments.reduce((sum, p) => sum + p.amount, 0);
  const grandTotal = order.subscription?.grand_total ?? 0;

  if (order.subscription_id) {
    const fullyPaid = totalPaid >= grandTotal;
    await prisma.subscription.update({
      where: { id: order.subscription_id },
      data: {
        status: fullyPaid ? 'ACTIVE' : 'PAST_DUE',
        fully_paid_at: fullyPaid ? new Date() : null,
      },
    });
  }

  const pipeline = await prisma.orderPipeline.findFirst({ where: { order_id: orderId } });
  if (pipeline) {
    await prisma.orderPipeline.update({
      where: { id: pipeline.id },
      data: {
        overall_progress: 100,
        completed_at: new Date(),
        current_step: 'FINAL_PAYMENT',
        is_stalled: false,
      },
    });
  }

  if (totalPaid >= grandTotal) {
    await prisma.cardOrder.update({
      where: { id: orderId },
      data: { payment_status: 'FULLY_PAID', status_note: notes || null },
    });
  }

  await applyTransition({
    orderId,
    from: ORDER_STATUS.DELIVERED,
    to: ORDER_STATUS.COMPLETED,
    actorId: finalizedBy,
    actorType: 'ADMIN',
    schoolId: order.school_id,
    meta: { totalPaid, grandTotal, notes },
    eventPayload: { orderNumber: order.order_number },
  });

  // Generate final invoice directly — no queue
  await generateOrderInvoice(orderId);

  logger.info(
    { orderId, finalizedBy, totalPaid, grandTotal },
    '[completion.handler] Order finalized'
  );

  return {
    orderId,
    completedAt: new Date(),
    totalPaid,
    grandTotal,
    newStatus: ORDER_STATUS.COMPLETED,
  };
}

export async function generateCompletionReport(orderId) {
  const order = await prisma.cardOrder.findUnique({
    where: { id: orderId },
    include: {
      school: true,
      subscription: true,
      payments: true,
      tokens: { include: { student: true, qrAsset: true } },
      cards: true,
      items: true,
      statusLogs: { orderBy: { created_at: 'asc' } },
    },
  });

  if (!order) throw new Error(`Order ${orderId} not found`);

  const totalPaid = order.payments.reduce((sum, p) => sum + p.amount, 0);

  return {
    order: {
      id: order.id,
      orderNumber: order.order_number,
      orderType: order.order_type,
      studentCount: order.student_count,
      status: order.status,
      createdAt: order.created_at,
      completedAt: order.status_changed_at,
    },
    school: { id: order.school.id, name: order.school.name, code: order.school.code },
    financial: {
      grandTotal: order.subscription?.grand_total ?? 0,
      totalPaid,
      balance: (order.subscription?.grand_total ?? 0) - totalPaid,
      payments: order.payments.map(p => ({ amount: p.amount, createdAt: p.created_at })),
    },
    production: {
      totalTokens: order.tokens.length,
      totalCards: order.cards.length,
      tokensGeneratedAt: order.tokens_generated_at,
      cardsDesignedAt: order.card_design_at,
    },
    timeline: order.statusLogs.map(log => ({
      fromStatus: log.from_status,
      toStatus: log.to_status,
      changedBy: log.changed_by,
      timestamp: log.created_at,
    })),
  };
}
