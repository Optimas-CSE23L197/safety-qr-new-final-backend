// =============================================================================
// services/idempotency.service.js
// =============================================================================

import { workerRedis } from '#config/redis.js';
import { logger } from '#config/logger.js';
import {
  REDIS_KEYS,
  IDEMPOTENCY_TTL_SECONDS,
  DISTRIBUTED_LOCK_TTL_MS, // ✅ merged into single import
} from './orchestrator.constants.js';

export async function claimExecution(orderId, step, ttlSeconds = IDEMPOTENCY_TTL_SECONDS) {
  const key = REDIS_KEYS.IDEMPOTENCY(orderId, step);
  const claimed = await workerRedis.set(key, 'running', 'EX', ttlSeconds, 'NX');

  if (!claimed) {
    const existing = await workerRedis.get(key);
    logger.info({
      msg: 'Idempotency: already claimed',
      orderId,
      step,
      existing,
    });
    return { claimed: false, existing };
  }

  logger.info({ msg: 'Idempotency: claimed', orderId, step });
  return { claimed: true };
}

export async function markCompleted(
  orderId,
  step,
  result = {},
  ttlSeconds = IDEMPOTENCY_TTL_SECONDS
) {
  const key = REDIS_KEYS.IDEMPOTENCY(orderId, step);
  const value = `completed:${JSON.stringify(result)}`;

  // ✅ FIX: was `redis.set` — redis was never imported, workerRedis is correct
  await workerRedis.set(key, value, 'EX', ttlSeconds);
  logger.info({ msg: 'Idempotency: marked completed', orderId, step });
}

export async function releaseClaim(orderId, step) {
  const key = REDIS_KEYS.IDEMPOTENCY(orderId, step);

  // ✅ FIX: was `redis.del` — same undefined variable bug
  await workerRedis.del(key);
  logger.info({ msg: 'Idempotency: claim released', orderId, step });
}

export async function checkStatus(orderId, step) {
  const key = REDIS_KEYS.IDEMPOTENCY(orderId, step);
  const value = await workerRedis.get(key);

  if (!value) return 'unclaimed';
  if (value === 'running') return 'running';
  if (value.startsWith('completed')) return 'completed';
  return 'unknown';
}

// =============================================================================
// Distributed lock
// =============================================================================

export async function acquireLock(orderId, step) {
  const key = REDIS_KEYS.LOCK(orderId, step);
  const ttlSec = Math.ceil(DISTRIBUTED_LOCK_TTL_MS / 1000);

  const result = await workerRedis.set(key, '1', 'EX', ttlSec, 'NX');
  return result === 'OK';
}

export async function releaseLock(orderId, step) {
  const key = REDIS_KEYS.LOCK(orderId, step);
  await workerRedis.del(key);
}
