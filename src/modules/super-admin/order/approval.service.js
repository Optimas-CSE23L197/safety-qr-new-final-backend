// =============================================================================
// src/modules/super-admin/orders/approval.service.js — RESQID
// Super-admin order approval/rejection CRUD.
// Moved from orchestrator/handlers/approval.handler.js — not an orchestrator handler.
// =============================================================================

import { prisma } from '#config/prisma.js';
import { logger } from '#config/logger.js';

/**
 * Check if an order can be auto-approved.
 * BLANK orders under 100 cards from DASHBOARD channel auto-approve.
 */
export async function isAutoApprovable(orderId) {
  const order = await prisma.cardOrder.findUnique({
    where: { id: orderId },
    select: { order_type: true, channel: true, card_count: true },
  });

  if (!order) return { autoApprovable: false, reason: 'Order not found' };

  if (order.order_type === 'BLANK' && order.card_count <= 100 && order.channel === 'DASHBOARD') {
    return { autoApprovable: true, reason: 'BLANK order under 100 cards' };
  }

  return { autoApprovable: false, reason: 'Requires super admin approval' };
}

/**
 * Load full order details for the approval review screen.
 */
export async function getOrderForApproval(orderId) {
  const order = await prisma.cardOrder.findUnique({
    where: { id: orderId },
    include: {
      school: {
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          address: true,
          subscription: {
            select: { plan: true, student_count: true, unit_price: true, total_amount: true },
          },
        },
      },
      items: {
        take: 10,
        select: { id: true, student_name: true, class: true, section: true, photo_url: true },
      },
    },
  });

  if (!order) return null;

  return {
    id: order.id,
    order_number: order.order_number,
    order_type: order.order_type,
    channel: order.channel,
    card_count: order.card_count,
    school: order.school,
    items: order.items,
    delivery_address: {
      name: order.delivery_name,
      phone: order.delivery_phone,
      address: order.delivery_address,
      city: order.delivery_city,
      state: order.delivery_state,
      pincode: order.delivery_pincode,
    },
    call_context:
      order.channel === 'CALL'
        ? {
            caller_name: order.caller_name,
            caller_phone: order.caller_phone,
            call_notes: order.call_notes,
          }
        : null,
    created_at: order.created_at,
  };
}

/**
 * Apply approval — transitions order to CONFIRMED via applyTransition so the
 * state machine and event bus are notified.
 */
export async function applyApproval(orderId, approvedBy, notes, metadata = {}) {
  // Import here to avoid circular dependency with orchestrator layer
  const { applyTransition } = await import('#orchestrator/state/order.guards.js');
  const { ORDER_STATUS } = await import('#orchestrator/state/order.states.js');

  const order = await prisma.cardOrder.findUnique({
    where: { id: orderId },
    select: { id: true, status: true, school_id: true, order_number: true },
  });

  if (!order) throw new Error(`applyApproval: order not found: ${orderId}`);

  // Write extra fields before transition so they're readable in event handlers
  await prisma.cardOrder.update({
    where: { id: orderId },
    data: {
      confirmed_by: approvedBy,
      confirmed_at: new Date(),
      status_note: notes,
      admin_notes: metadata.admin_notes ?? null,
    },
  });

  await applyTransition({
    orderId,
    from: order.status,
    to: ORDER_STATUS.CONFIRMED,
    actorId: approvedBy,
    actorType: 'SUPER_ADMIN',
    schoolId: order.school_id,
    meta: { notes, ...metadata },
    eventPayload: { orderNumber: order.order_number, notes },
  });

  logger.info({ orderId, approvedBy }, '[approval.service] Order approved');
  return prisma.cardOrder.findUnique({ where: { id: orderId } });
}

/**
 * Reject an order — transitions to CANCELLED via applyTransition.
 */
export async function rejectOrder(orderId, rejectedBy, reason) {
  const { applyTransition } = await import('#orchestrator/state/order.guards.js');
  const { ORDER_STATUS } = await import('#orchestrator/state/order.states.js');

  const order = await prisma.cardOrder.findUnique({
    where: { id: orderId },
    select: { id: true, status: true, school_id: true, order_number: true },
  });

  if (!order) throw new Error(`rejectOrder: order not found: ${orderId}`);

  await applyTransition({
    orderId,
    from: order.status,
    to: ORDER_STATUS.CANCELLED,
    actorId: rejectedBy,
    actorType: 'SUPER_ADMIN',
    schoolId: order.school_id,
    meta: { reason },
    eventPayload: { orderNumber: order.order_number, reason },
  });

  logger.info({ orderId, rejectedBy, reason }, '[approval.service] Order rejected');
  return prisma.cardOrder.findUnique({ where: { id: orderId } });
}

/**
 * Paginated list of pending orders for the super-admin approval queue.
 */
export async function getPendingApprovals(filters = {}) {
  const where = { status: 'PENDING' };

  if (filters.schoolId) where.school_id = filters.schoolId;
  if (filters.orderType) where.order_type = filters.orderType;

  const [orders, total] = await Promise.all([
    prisma.cardOrder.findMany({
      where,
      include: {
        school: { select: { id: true, name: true, city: true, state: true } },
      },
      orderBy: { created_at: 'asc' },
      take: filters.limit || 50,
      skip: filters.offset || 0,
    }),
    prisma.cardOrder.count({ where }),
  ]);

  return { orders, total, pending: total };
}
