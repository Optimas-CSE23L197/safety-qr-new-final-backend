// =============================================================================
// services/state.service.js
// Manages the canonical order state — DB is source of truth, Redis is cache.
// =============================================================================

import { prisma } from "../../../config/prisma.js";
import { redis } from "../../../config/redis.js";
import { logger } from "../../../config/logger.js";
import { REDIS_KEYS } from "../orchestrator.constants.js";
import { validateTransition } from "../state/order.transitions.js";
import { ORDER_STATES, STATE_TO_STEP } from "../state/order.states.js";

const STATE_CACHE_TTL = 300; // 5 min

// =============================================================================
// Redis helpers — all cache ops are non-blocking and fail-safe.
// The DB is the source of truth. Redis is purely a read-performance optimisation.
// A Redis error must NEVER block or crash an HTTP request.
// =============================================================================

/**
 * Safe fire-and-forget cache write.
 * Never awaited on the hot path — errors are logged, never thrown.
 */
function cacheSet(key, value, ttl) {
  redis.set(key, value, "EX", ttl).catch((err) => {
    logger.warn({
      msg: "Redis cache write failed — non-fatal, DB remains source of truth",
      key,
      err: err.message,
    });
  });
}

/**
 * Safe fire-and-forget cache delete.
 * Never awaited on the hot path — errors are logged, never thrown.
 */
function cacheDel(key) {
  redis.del(key).catch((err) => {
    logger.warn({
      msg: "Redis cache delete failed — non-fatal",
      key,
      err: err.message,
    });
  });
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Get current orchestrator state for an order.
 * Checks Redis cache first, falls back to DB.
 * Redis errors are swallowed — DB is always the fallback.
 *
 * @returns {Promise<string>} orchestrator state key (e.g. 'ADVANCE_PAID')
 */
export async function getOrderState(orderId) {
  const cacheKey = REDIS_KEYS.STATE(orderId);

  // ✅ Cache read: fail open — a Redis hiccup must never block the response.
  // If redis.get throws (offline queue disabled, connection lost, timeout),
  // we catch and fall through to the DB silently.
  try {
    const cached = await redis.get(cacheKey);
    if (cached) return cached;
  } catch (err) {
    logger.warn({
      msg: "Redis cache read failed — falling back to DB",
      orderId,
      err: err.message,
    });
    // fall through to DB
  }

  const order = await prisma.cardOrder.findUnique({
    where: { id: orderId },
    select: { status: true },
  });

  if (!order) throw new Error(`Order ${orderId} not found`);

  // Reverse-map DB status → orchestrator state key
  const orchState = dbStatusToOrchestratorState(order.status);

  // ✅ Cache write: fire-and-forget — do NOT await this.
  // Awaiting a redis.set on the HTTP request path is what caused the
  // socket hang — if Redis stalls, the entire async chain blocks and the
  // response body is never flushed even though headers (200) were already sent.
  cacheSet(cacheKey, orchState, STATE_CACHE_TTL);

  return orchState; // returns immediately, doesn't wait for Redis
}

/**
 * Transition order to a new state.
 * Validates transition, updates DB + pipeline record, invalidates cache.
 *
 * @param {string} orderId
 * @param {string} toState      - orchestrator state key
 * @param {string} triggeredBy  - actor ID
 * @param {object} meta         - optional: notes, metadata
 */
export async function transitionState(
  orderId,
  toState,
  triggeredBy,
  meta = {},
) {
  const currentState = await getOrderState(orderId);
  const { valid, reason } = validateTransition(currentState, toState);

  if (!valid) {
    throw new Error(`State transition blocked: ${reason}`);
  }

  const newDbStatus = ORDER_STATES[toState];
  const newStep = STATE_TO_STEP[toState];

  if (!newDbStatus)
    throw new Error(`No DB status mapping for state: ${toState}`);

  // Update DB atomically — this is the critical path, must succeed
  await prisma.$transaction(async (tx) => {
    // 1. Update CardOrder status
    await tx.cardOrder.update({
      where: { id: orderId },
      data: { status: newDbStatus, updated_at: new Date() },
    });

    // 2. Update OrderPipeline current_step and progress
    if (newStep) {
      await tx.orderPipeline.updateMany({
        where: { order_id: orderId },
        data: {
          current_step: newStep,
          overall_progress: computeProgress(toState),
          updated_at: new Date(),
        },
      });
    }
  });

  // ✅ Cache invalidation: fire-and-forget — DB already updated above.
  // If Redis del fails here, the next getOrderState will get a stale cache hit
  // but that resolves itself on TTL expiry (5 min). This is acceptable and
  // far better than blocking/throwing after a successful DB write.
  cacheDel(REDIS_KEYS.STATE(orderId));

  logger.info({
    msg: "State transitioned",
    orderId,
    from: currentState,
    to: toState,
    dbStatus: newDbStatus,
    step: newStep,
    triggeredBy,
  });

  return { from: currentState, to: toState };
}

/**
 * Mark pipeline as stalled.
 */
export async function markStalled(orderId, reason) {
  await prisma.orderPipeline.updateMany({
    where: { order_id: orderId },
    data: { is_stalled: true, stalled_at: new Date(), stalled_reason: reason },
  });
  logger.warn({ msg: "Pipeline marked stalled", orderId, reason });
}

// =============================================================================
// Helpers
// =============================================================================

function dbStatusToOrchestratorState(dbStatus) {
  // Invert ORDER_STATES map
  const map = Object.entries(ORDER_STATES).find(([, v]) => v === dbStatus);
  if (map) return map[0];

  // Fallback for statuses we map to multiple orch states
  const fallbacks = {
    PENDING: "PENDING", // Not PENDING_APPROVAL
    CONFIRMED: "APPROVED",
    PAYMENT_PENDING: "ADVANCE_PENDING",
    ADVANCE_RECEIVED: "ADVANCE_PAID", // ← This was ADVANCE_PAID
    TOKEN_GENERATED: "TOKEN_GENERATED",
    CARD_DESIGN_READY: "CARD_GENERATED",
    SENT_TO_VENDOR: "DESIGN_DONE",
    PRINTING: "PRINTING",
    SHIPPED: "SHIPPED",
    DELIVERED: "DELIVERED",
    COMPLETED: "COMPLETED",
    CANCELLED: "CANCELLED",
    FAILED: "FAILED",
  };

  return fallbacks[dbStatus] || "CREATED";
}

function computeProgress(state) {
  const PROGRESS_MAP = {
    CREATED: 5,
    PENDING_APPROVAL: 10,
    APPROVED: 20,
    ADVANCE_PENDING: 25,
    ADVANCE_PAID: 35,
    TOKEN_GENERATED: 50,
    CARD_GENERATED: 60,
    DESIGN_DONE: 70,
    VENDOR_ASSIGNED: 75,
    PRINTING: 80,
    SHIPPED: 88,
    DELIVERED: 95,
    COMPLETED: 100,
    CANCELLED: 0,
    FAILED: 0,
  };
  return PROGRESS_MAP[state] ?? 0;
}
