// =============================================================================
// orchestrator/state/order.guards.js — RESQID PHASE 1
// Manages the canonical order state — DB is source of truth, Redis is cache.
// =============================================================================

import { prisma } from '#config/prisma.js';
import { redis } from '#config/redis.js';
import { logger } from '#config/logger.js';
import { REDIS_KEYS } from '../orchestrator.constants.js';
import { TRANSITIONS } from './order.transitions.js';
import { ORDER_STATUS } from './order.states.js';

const STATE_CACHE_TTL = 300; // 5 min

function cacheSet(key, value, ttl) {
  redis.set(key, value, 'EX', ttl).catch(err => {
    logger.warn({ msg: 'Redis cache write failed — non-fatal', key, err: err.message });
  });
}

function cacheDel(key) {
  redis.del(key).catch(err => {
    logger.warn({ msg: 'Redis cache delete failed — non-fatal', key, err: err.message });
  });
}

export const validateTransition = (from, to) => {
  const allowed = TRANSITIONS.get(from);
  if (!allowed) return { valid: false, reason: `Unknown state: ${from}` };
  if (allowed.has(to)) return { valid: true, reason: null };
  return { valid: false, reason: `${from} → ${to} not allowed` };
};

export async function getOrderState(orderId) {
  const cacheKey = REDIS_KEYS.STATE(orderId);
  try {
    const cached = await redis.get(cacheKey);
    if (cached) return cached;
  } catch (err) {
    logger.warn({ msg: 'Redis cache read failed — falling back to DB', orderId, err: err.message });
  }

  const order = await prisma.cardOrder.findUnique({
    where: { id: orderId },
    select: { status: true },
  });

  if (!order) throw new Error(`Order ${orderId} not found`);

  const orchState = dbStatusToOrchestratorState(order.status);
  cacheSet(cacheKey, orchState, STATE_CACHE_TTL);
  return orchState;
}

export async function transitionState(orderId, toState, triggeredBy, meta = {}) {
  const currentState = await getOrderState(orderId);
  const { valid, reason } = validateTransition(currentState, toState);
  if (!valid) throw new Error(`State transition blocked: ${reason}`);

  const newDbStatus = ORDER_STATUS[toState];
  if (!newDbStatus) throw new Error(`No DB status mapping for state: ${toState}`);

  await prisma.$transaction(async tx => {
    await tx.cardOrder.update({
      where: { id: orderId },
      data: { status: newDbStatus, updated_at: new Date() },
    });
  });

  cacheDel(REDIS_KEYS.STATE(orderId));

  logger.info({
    msg: 'State transitioned',
    orderId,
    from: currentState,
    to: toState,
    dbStatus: newDbStatus,
    triggeredBy,
  });
  return { from: currentState, to: toState };
}

export const applyTransition = async ({
  orderId,
  to,
  actorId,
  actorType,
  schoolId,
  meta = {},
  eventPayload = {},
}) => {
  // Always fetch current state from source of truth — never trust caller's 'from'
  const currentState = await getOrderState(orderId);
  const { valid, reason } = validateTransition(currentState, to);
  if (!valid) throw new Error(`Invalid transition: ${reason}`);

  const newDbStatus = ORDER_STATUS[to];
  if (!newDbStatus) throw new Error(`No DB status mapping for state: ${to}`);

  await prisma.$transaction(async tx => {
    await tx.cardOrder.update({
      where: { id: orderId },
      data: { status: newDbStatus, updated_at: new Date() },
    });

    // Log the transition for audit
    await tx.orderStatusLog.create({
      data: {
        order_id: orderId,
        from_status: currentState,
        to_status: to,
        changed_by: actorId ?? 'SYSTEM',
        changed_by_type: actorType ?? 'SYSTEM',
        metadata: { ...meta, ...eventPayload },
      },
    });
  });

  cacheDel(REDIS_KEYS.STATE(orderId));

  logger.info({
    msg: 'State transition applied',
    orderId,
    from: currentState,
    to,
    actorId,
    actorType,
  });

  return { from: currentState, to };
};

export async function markStalled(orderId, reason) {
  await prisma.orderPipeline.updateMany({
    where: { order_id: orderId },
    data: { is_stalled: true, stalled_at: new Date(), stalled_reason: reason },
  });
  logger.warn({ msg: 'Pipeline marked stalled', orderId, reason });
}

// =============================================================================
// Helpers
// =============================================================================

function dbStatusToOrchestratorState(dbStatus) {
  if (Object.values(ORDER_STATUS).includes(dbStatus)) {
    return dbStatus;
  }

  const fallbacks = {
    CONFIRMED: 'CONFIRMED',
    PAYMENT_PENDING: 'PAYMENT_PENDING',
    ADVANCE_RECEIVED: 'ADVANCE_RECEIVED',
    TOKEN_GENERATED: 'TOKEN_GENERATED',
    CARD_DESIGN: 'CARD_DESIGN',
    CARD_DESIGN_READY: 'CARD_DESIGN_READY',
    CARD_DESIGN_REVISION: 'CARD_DESIGN_REVISION',
    DESIGN_APPROVED: 'DESIGN_APPROVED',
    SENT_TO_VENDOR: 'SENT_TO_VENDOR',
    PRINTING: 'PRINTING',
    PRINT_COMPLETE: 'PRINT_COMPLETE',
    READY_TO_SHIP: 'READY_TO_SHIP',
    SHIPPED: 'SHIPPED',
    OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
    DELIVERED: 'DELIVERED',
    BALANCE_PENDING: 'BALANCE_PENDING',
    COMPLETED: 'COMPLETED',
    CANCELLED: 'CANCELLED',
    REFUNDED: 'REFUNDED',
  };

  return fallbacks[dbStatus] || 'PENDING';
}

export function computeProgress(state) {
  const PROGRESS_MAP = {
    PENDING: 5,
    CONFIRMED: 10,
    PAYMENT_PENDING: 20,
    ADVANCE_RECEIVED: 30,
    TOKEN_GENERATED: 40,
    CARD_DESIGN: 50,
    CARD_DESIGN_READY: 60,
    CARD_DESIGN_REVISION: 55,
    DESIGN_APPROVED: 65,
    SENT_TO_VENDOR: 70,
    PRINTING: 75,
    PRINT_COMPLETE: 80,
    READY_TO_SHIP: 85,
    SHIPPED: 90,
    OUT_FOR_DELIVERY: 92,
    DELIVERED: 95,
    BALANCE_PENDING: 97,
    COMPLETED: 100,
    CANCELLED: 0,
    REFUNDED: 0,
    ON_HOLD: -1,
  };
  return PROGRESS_MAP[state] ?? 0;
}
