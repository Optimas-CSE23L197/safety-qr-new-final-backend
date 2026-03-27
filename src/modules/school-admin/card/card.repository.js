// =============================================================================
// modules/school_admin/card_requests/cardRequests.repository.js — RESQID
// ALL Prisma calls for card requests. Nothing else.
//
// Maps to: CardOrder model (channel = DASHBOARD)
// School admin submits orders via dashboard — super admin reviews them.
//
// INDEXES USED:
//   CardOrder → @@index([school_id])          — base filter
//   CardOrder → @@index([school_id, status])  — status filter hot path
//   CardOrder → @@index([status, created_at]) — ordering
// =============================================================================

import { prisma } from '#config/prisma.js';

/**
 * findCardRequests({ schoolId, status, search, skip, take })
 * Returns { orders, total, counts }
 * counts = { ALL, PENDING, APPROVED, REJECTED } — for tab badges, one extra query
 */
export async function findCardRequests({ schoolId, status, search, skip, take }) {
  // ── WHERE clause ──────────────────────────────────────────────────────────
  const baseWhere = {
    school_id: schoolId,
    channel: 'DASHBOARD', // only school-submitted orders

    // Map frontend status to OrderStatus values
    ...(status &&
      status !== 'ALL' && {
        status: STATUS_MAP[status],
      }),

    // Search by school name (denorm not available on CardOrder — search via relation)
    // OR by order_number which is always available
    ...(search && {
      OR: [
        { order_number: { contains: search, mode: 'insensitive' } },
        { notes: { contains: search, mode: 'insensitive' } },
        { school: { name: { contains: search, mode: 'insensitive' } } },
      ],
    }),
  };

  // ── Parallel: page data + total count + status counts ────────────────────
  const [orders, total, pendingCount, approvedCount, rejectedCount] = await Promise.all([
    prisma.cardOrder.findMany({
      where: baseWhere,
      orderBy: { created_at: 'desc' },
      skip,
      take,
      select: {
        id: true,
        order_number: true,
        card_count: true,
        order_type: true,
        status: true,
        payment_status: true,
        notes: true,
        delivery_name: true,
        delivery_phone: true,
        delivery_address: true,
        delivery_city: true,
        delivery_state: true,
        delivery_pincode: true,
        status_note: true, // rejection reason lives here
        created_at: true,
        status_changed_at: true, // reviewed_at equivalent
        school: {
          select: { id: true, name: true, code: true },
        },
      },
    }),

    // Total for current filter (for pagination)
    prisma.cardOrder.count({ where: baseWhere }),

    // Status counts for tab badges — always scoped to this school
    prisma.cardOrder.count({
      where: {
        school_id: schoolId,
        channel: 'DASHBOARD',
        status: { in: PENDING_STATUSES },
      },
    }),
    prisma.cardOrder.count({
      where: {
        school_id: schoolId,
        channel: 'DASHBOARD',
        status: { in: APPROVED_STATUSES },
      },
    }),
    prisma.cardOrder.count({
      where: {
        school_id: schoolId,
        channel: 'DASHBOARD',
        status: 'CANCELLED',
      },
    }),
  ]);

  // Shape for frontend
  const shaped = orders.map(shapeOrder);

  return {
    orders: shaped,
    total,
    counts: {
      ALL: pendingCount + approvedCount + rejectedCount,
      PENDING: pendingCount,
      APPROVED: approvedCount,
      REJECTED: rejectedCount,
    },
  };
}

/**
 * createCardOrder({ schoolId, schoolUserId, body })
 * Creates a new CardOrder from a school admin dashboard submission.
 * channel = DASHBOARD, status = PENDING automatically.
 * order_number is auto-generated.
 */
export async function createCardOrder({ schoolId, schoolUserId, body }) {
  const orderNumber = await generateOrderNumber();

  return prisma.cardOrder.create({
    data: {
      school_id: schoolId,
      order_number: orderNumber,
      order_type: body.order_type,
      order_mode: 'BULK',
      channel: 'DASHBOARD',
      card_count: body.card_count,
      status: 'PENDING',
      payment_status: 'UNPAID',
      notes: body.notes,
      delivery_name: body.delivery_name,
      delivery_phone: body.delivery_phone,
      delivery_address: body.delivery_address,
      delivery_city: body.delivery_city,
      delivery_state: body.delivery_state,
      delivery_pincode: body.delivery_pincode,
    },
    select: {
      id: true,
      order_number: true,
      card_count: true,
      status: true,
      created_at: true,
    },
  });
}

// ─── Status Mapping ───────────────────────────────────────────────────────────
// Frontend uses simple PENDING/APPROVED/REJECTED
// CardOrder has a detailed 15-step status lifecycle
// We map frontend tabs to groups of OrderStatus values

const PENDING_STATUSES = [
  'PENDING',
  'CONFIRMED',
  'PAYMENT_PENDING',
  'ADVANCE_RECEIVED',
  'TOKEN_GENERATION',
  'TOKEN_GENERATED',
  'CARD_DESIGN',
  'CARD_DESIGN_READY',
  'CARD_DESIGN_REVISION',
  'SENT_TO_VENDOR',
  'PRINTING',
  'PRINT_COMPLETE',
  'READY_TO_SHIP',
  'SHIPPED',
  'OUT_FOR_DELIVERY',
];

const APPROVED_STATUSES = ['DELIVERED', 'BALANCE_PENDING', 'COMPLETED'];

const STATUS_MAP = {
  PENDING: { in: PENDING_STATUSES },
  APPROVED: { in: APPROVED_STATUSES },
  REJECTED: 'CANCELLED',
};

// ─── Shape ────────────────────────────────────────────────────────────────────
// Map DB fields to what the frontend CardRequests.jsx expects

function shapeOrder(order) {
  return {
    id: order.id,
    order_number: order.order_number,
    school_id: order.school?.id,
    school_name: order.school?.name,
    school_code: order.school?.code,
    card_count: order.card_count,
    order_type: order.order_type,
    notes: order.notes,
    status: deriveSimpleStatus(order.status),
    raw_status: order.status, // full status for detailed view
    payment_status: order.payment_status,
    delivery_address: {
      name: order.delivery_name,
      phone: order.delivery_phone,
      line1: order.delivery_address,
      city: order.delivery_city,
      state: order.delivery_state,
      pincode: order.delivery_pincode,
    },
    reject_reason: order.status === 'CANCELLED' ? order.status_note : null,
    reviewed_at: order.status_changed_at,
    created_at: order.created_at,
  };
}

function deriveSimpleStatus(orderStatus) {
  if (APPROVED_STATUSES.includes(orderStatus)) return 'APPROVED';
  if (orderStatus === 'CANCELLED') return 'REJECTED';
  return 'PENDING';
}

// ─── Order Number Generator ───────────────────────────────────────────────────
// Format: ORD-2025-0042
// Finds the latest order number and increments — simple and readable

async function generateOrderNumber() {
  const year = new Date().getFullYear();
  const prefix = `ORD-${year}-`;

  const latest = await prisma.cardOrder.findFirst({
    where: { order_number: { startsWith: prefix } },
    orderBy: { order_number: 'desc' },
    select: { order_number: true },
  });

  const lastNum = latest ? parseInt(latest.order_number.split('-')[2], 10) : 0;

  return `${prefix}${String(lastNum + 1).padStart(4, '0')}`;
}
