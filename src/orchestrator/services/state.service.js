// =============================================================================
// services/state.service.js — RESQID PHASE 1
// Manages the canonical order state — DB is source of truth, Redis is cache.
// =============================================================================

import { prisma } from '#config/prisma.js';
import { redis } from '#config/redis.js';
import { logger } from '#config/logger.js';
import { REDIS_KEYS } from '../orchestrator.constants.js';
import { validateTransition } from '../state/order.transitions.js';
import { ORDER_STATUS } from '../state/order.states.js';

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
  // Direct mapping: if DB status matches one of our constants, return it
  if (Object.values(ORDER_STATUS).includes(dbStatus)) {
    return dbStatus;
  }

  // Fallbacks for legacy/ambiguous statuses
  const fallbacks = {
    CONFIRMED: 'CONFIRMED',
    PAYMENT_PENDING: 'PAYMENT_PENDING',
    PARTIAL_PAYMENT_CONFIRMED: 'PARTIAL_PAYMENT_CONFIRMED',
    PARTIAL_INVOICE_GENERATED: 'PARTIAL_INVOICE_GENERATED',
    ADVANCE_RECEIVED: 'ADVANCE_RECEIVED',
    TOKEN_GENERATING: 'TOKEN_GENERATING',
    TOKEN_COMPLETE: 'TOKEN_COMPLETE',
    DESIGN_GENERATING: 'DESIGN_GENERATING',
    DESIGN_COMPLETE: 'DESIGN_COMPLETE',
    DESIGN_APPROVED: 'DESIGN_APPROVED',
    VENDOR_SENT: 'VENDOR_SENT',
    PRINTING: 'PRINTING',
    SHIPPED: 'SHIPPED',
    DELIVERED: 'DELIVERED',
    COMPLETED: 'COMPLETED',
    CANCELLED: 'CANCELLED',
    REFUNDED: 'REFUNDED',
  };

  return fallbacks[dbStatus] || 'PENDING';
}

function computeProgress(state) {
  const PROGRESS_MAP = {
    PENDING: 5,
    CONFIRMED: 10,
    PARTIAL_PAYMENT_CONFIRMED: 15,
    PARTIAL_INVOICE_GENERATED: 20,
    PAYMENT_PENDING: 25,
    ADVANCE_RECEIVED: 30,
    TOKEN_GENERATING: 40,
    TOKEN_COMPLETE: 50,
    DESIGN_GENERATING: 60,
    DESIGN_COMPLETE: 70,
    DESIGN_APPROVED: 75,
    VENDOR_SENT: 80,
    PRINTING: 85,
    SHIPPED: 90,
    DELIVERED: 95,
    COMPLETED: 100,
    CANCELLED: 0,
    REFUNDED: 0,
  };
  return PROGRESS_MAP[state] ?? 0;
}
