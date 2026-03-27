// =============================================================================
// handlers/completion.handler.js
// Business logic for order completion and finalization.
// =============================================================================

import { prisma } from '#config/prisma.js';

/**
 * Finalize order and mark as completed
 */
export async function finalizeOrder(orderId, finalizedBy, notes = '') {
  const order = await prisma.cardOrder.findUnique({
    where: { id: orderId },
    include: {
      subscription: true,
      payments: true,
    },
  });

  if (!order) {
    throw new Error(`Order ${orderId} not found`);
  }

  if (order.status !== 'DELIVERED') {
    throw new Error(`Order ${orderId} must be delivered before completion`);
  }

  const completedAt = new Date();

  // Calculate total paid
  const totalPaid = order.payments.reduce((sum, p) => sum + p.amount, 0);
  const grandTotal = order.subscription?.grand_total || 0;

  // Update order
  const updatedOrder = await prisma.cardOrder.update({
    where: { id: orderId },
    data: {
      status: 'COMPLETED',
      payment_status: totalPaid >= grandTotal ? 'PAID' : order.payment_status,
      status_changed_by: finalizedBy,
      status_changed_at: completedAt,
      status_note: notes,
    },
  });

  // Update subscription if exists
  if (order.subscription_id) {
    await prisma.subscription.update({
      where: { id: order.subscription_id },
      data: {
        status: totalPaid >= grandTotal ? 'ACTIVE' : 'PAST_DUE',
        fully_paid_at: totalPaid >= grandTotal ? completedAt : undefined,
      },
    });
  }

  // Update pipeline
  const pipeline = await prisma.orderPipeline.findFirst({
    where: { order_id: orderId },
  });

  if (pipeline) {
    await prisma.orderPipeline.update({
      where: { id: pipeline.id },
      data: {
        overall_progress: 100,
        completed_at: completedAt,
        current_step: 'BALANCE_PAYMENT',
        is_stalled: false,
      },
    });
  }

  // Create status log
  await prisma.orderStatusLog.create({
    data: {
      order_id: orderId,
      from_status: 'DELIVERED',
      to_status: 'COMPLETED',
      changed_by: finalizedBy,
      note: notes || 'Order completed',
      metadata: {
        completedAt,
        totalPaid,
        grandTotal,
      },
    },
  });

  return {
    order: updatedOrder,
    completedAt,
    totalPaid,
    grandTotal,
  };
}

/**
 * Generate completion certificate/report
 */
export async function generateCompletionReport(orderId) {
  const order = await prisma.cardOrder.findUnique({
    where: { id: orderId },
    include: {
      school: true,
      subscription: true,
      payments: true,
      tokens: {
        include: {
          student: true,
          qrAsset: true,
        },
      },
      cards: true,
      items: true,
      statusLogs: {
        orderBy: { created_at: 'asc' },
      },
    },
  });

  if (!order) {
    throw new Error(`Order ${orderId} not found`);
  }

  // Calculate metrics
  const totalPaid = order.payments.reduce((sum, p) => sum + p.amount, 0);
  const totalTokens = order.tokens.length;
  const totalCards = order.cards.length;
  const totalStudents = order.tokens.filter(t => t.student_id).length;

  // Build timeline
  const timeline = order.statusLogs.map(log => ({
    fromStatus: log.from_status,
    toStatus: log.to_status,
    changedBy: log.changed_by,
    note: log.note,
    timestamp: log.created_at,
  }));

  return {
    order: {
      id: order.id,
      orderNumber: order.order_number,
      orderType: order.order_type,
      cardCount: order.card_count,
      status: order.status,
      createdAt: order.created_at,
      completedAt: order.status_changed_at,
    },
    school: {
      id: order.school.id,
      name: order.school.name,
      code: order.school.code,
      address: order.school.address,
    },
    financial: {
      grandTotal: order.subscription?.grand_total || 0,
      totalPaid,
      balance: (order.subscription?.grand_total || 0) - totalPaid,
      payments: order.payments.map(p => ({
        amount: p.amount,
        provider: p.provider,
        providerRef: p.provider_ref,
        createdAt: p.created_at,
      })),
    },
    production: {
      totalTokens,
      totalCards,
      totalStudents,
      tokensGeneratedAt: order.tokens_generated_at,
      cardsDesignedAt: order.card_design_at,
      printCompletedAt: order.print_complete_at,
    },
    timeline,
  };
}

/**
 * Archive completed order
 */
export async function archiveOrder(orderId, archivedBy) {
  // In production, this might move data to archive table
  // For now, just mark as archived in metadata
  const order = await prisma.cardOrder.update({
    where: { id: orderId },
    data: {
      admin_notes: `Archived by ${archivedBy} on ${new Date().toISOString()}`,
    },
  });

  await prisma.auditLog.create({
    data: {
      school_id: order.school_id,
      actor_id: archivedBy,
      actor_type: 'SUPER_ADMIN',
      action: 'ORDER_ARCHIVED',
      entity: 'CardOrder',
      entity_id: orderId,
      new_value: { archivedAt: new Date() },
    },
  });

  return order;
}
