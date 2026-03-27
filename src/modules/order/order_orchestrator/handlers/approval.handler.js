// =============================================================================
// handlers/approval.handler.js
// Business logic for order approval.
// =============================================================================

import { prisma } from '#config/database/prisma.js';
import { logger } from '#config/logger.js';

/**
 * Check if order can be auto-approved
 */
export async function isAutoApprovable(orderId) {
  const order = await prisma.cardOrder.findUnique({
    where: { id: orderId },
    select: {
      order_type: true,
      channel: true,
      card_count: true,
      school_id: true,
    },
  });

  if (!order) return { autoApprovable: false, reason: 'Order not found' };

  // Auto-approve BLANK orders under 100 cards from dashboard
  if (order.order_type === 'BLANK' && order.card_count <= 100 && order.channel === 'DASHBOARD') {
    return { autoApprovable: true, reason: 'BLANK order under 100 cards' };
  }

  return { autoApprovable: false, reason: 'Requires super admin approval' };
}

/**
 * Get order details for approval review
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
            select: {
              plan: true,
              student_count: true,
              unit_price: true,
              total_amount: true,
            },
          },
        },
      },
      items: {
        take: 10,
        select: {
          id: true,
          student_name: true,
          class: true,
          section: true,
          photo_url: true,
        },
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
 * Update order with approval details
 */
export async function applyApproval(orderId, approvedBy, notes, metadata = {}) {
  const order = await prisma.cardOrder.update({
    where: { id: orderId },
    data: {
      status: 'CONFIRMED',
      confirmed_by: approvedBy,
      confirmed_at: new Date(),
      status_note: notes,
      admin_notes: metadata.admin_notes,
    },
  });

  // Create audit log
  await prisma.auditLog.create({
    data: {
      school_id: order.school_id,
      actor_id: approvedBy,
      actor_type: 'SUPER_ADMIN',
      action: 'ORDER_APPROVED',
      entity: 'CardOrder',
      entity_id: orderId,
      new_value: { notes, metadata },
    },
  });

  return order;
}

/**
 * Reject order (set to cancelled)
 */
export async function rejectOrder(orderId, rejectedBy, reason) {
  const order = await prisma.cardOrder.update({
    where: { id: orderId },
    data: {
      status: 'CANCELLED',
      status_note: reason,
      status_changed_by: rejectedBy,
      status_changed_at: new Date(),
    },
  });

  await prisma.orderStatusLog.create({
    data: {
      order_id: orderId,
      from_status: 'PENDING',
      to_status: 'CANCELLED',
      changed_by: rejectedBy,
      note: reason,
    },
  });

  return order;
}

/**
 * Get pending approvals for super admin dashboard
 */
export async function getPendingApprovals(filters = {}) {
  const where = {
    status: 'PENDING',
  };

  if (filters.schoolId) {
    where.school_id = filters.schoolId;
  }

  if (filters.orderType) {
    where.order_type = filters.orderType;
  }

  const orders = await prisma.cardOrder.findMany({
    where,
    include: {
      school: {
        select: {
          id: true,
          name: true,
          city: true,
          state: true,
        },
      },
    },
    orderBy: { created_at: 'asc' },
    take: filters.limit || 50,
    skip: filters.offset || 0,
  });

  const total = await prisma.cardOrder.count({ where });

  return {
    orders,
    total,
    pending: total,
  };
}
