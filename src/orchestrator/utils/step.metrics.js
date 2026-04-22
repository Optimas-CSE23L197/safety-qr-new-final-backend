// =============================================================================
// utils/step.metrics.js — RESQID PHASE 1
// Complete metrics collection for pipeline steps with aggregation.
// Gated behind ENABLE_STEP_METRICS — off by default to save Redis commands.
// =============================================================================

import { redis } from '#config/redis.js';
import { logger } from '#config/logger.js';

const METRICS_PREFIX = 'orch:metrics';
const RETENTION_DAYS = 30;
const DETAIL_RETENTION_HOURS = 24;

/**
 * Record step execution metric
 * Phase 1: disabled by default — set ENABLE_STEP_METRICS=true to enable
 */
export async function recordMetric(step, orderId, durationMs, status, metadata = {}) {
  if (process.env.ENABLE_STEP_METRICS !== 'true') {
    logger.debug({ msg: 'Step metric skipped (disabled)', step, orderId, status });
    return;
  }

  const timestamp = new Date();
  const hour = timestamp.toISOString().slice(0, 13);
  const day = timestamp.toISOString().slice(0, 10);
  const minute = timestamp.toISOString().slice(0, 16);

  const keys = {
    total: `${METRICS_PREFIX}:${step}:total`,
    success: `${METRICS_PREFIX}:${step}:success`,
    failure: `${METRICS_PREFIX}:${step}:failure`,
    duration: `${METRICS_PREFIX}:${step}:duration`,
    hourly: `${METRICS_PREFIX}:${step}:hourly:${hour}`,
    daily: `${METRICS_PREFIX}:${step}:daily:${day}`,
    minute: `${METRICS_PREFIX}:${step}:minute:${minute}`,
    order: `${METRICS_PREFIX}:order:${orderId}`,
  };

  const pipeline = redis.pipeline();

  pipeline.incr(keys.total);
  pipeline.expire(keys.total, 86400 * RETENTION_DAYS);

  if (status === 'success') {
    pipeline.incr(keys.success);
    pipeline.expire(keys.success, 86400 * RETENTION_DAYS);
  } else {
    pipeline.incr(keys.failure);
    pipeline.expire(keys.failure, 86400 * RETENTION_DAYS);
  }

  pipeline.lpush(keys.duration, durationMs);
  pipeline.ltrim(keys.duration, 0, 9999);
  pipeline.expire(keys.duration, 86400 * RETENTION_DAYS);

  pipeline.hincrby(keys.minute, 'total', 1);
  pipeline.hincrby(keys.minute, status, 1);
  pipeline.hincrby(keys.minute, 'duration', durationMs);
  pipeline.expire(keys.minute, 3600 * DETAIL_RETENTION_HOURS);

  pipeline.hincrby(keys.hourly, 'total', 1);
  pipeline.hincrby(keys.hourly, status, 1);
  pipeline.hincrby(keys.hourly, 'duration', durationMs);
  pipeline.expire(keys.hourly, 86400 * 2);

  pipeline.hincrby(keys.daily, 'total', 1);
  pipeline.hincrby(keys.daily, status, 1);
  pipeline.hincrby(keys.daily, 'duration', durationMs);
  pipeline.expire(keys.daily, 86400 * RETENTION_DAYS);

  pipeline.lpush(
    keys.order,
    JSON.stringify({ step, durationMs, status, metadata, timestamp: timestamp.toISOString() })
  );
  pipeline.ltrim(keys.order, 0, 99);
  pipeline.expire(keys.order, 86400 * 7);

  try {
    await pipeline.exec();
  } catch (err) {
    logger.warn({ msg: 'Metric write failed (non-fatal)', step, orderId, err: err.message });
  }

  logger.debug({ msg: 'Step metric recorded', step, orderId, durationMs, status });
}

/**
 * Get percentile for step duration
 */
async function getPercentile(step, percentile) {
  const key = `${METRICS_PREFIX}:${step}:duration`;
  let durations = [];
  try {
    durations = await redis.lrange(key, 0, 9999);
  } catch (err) {
    logger.warn({ msg: 'Percentile read failed', step, err: err.message });
    return 0;
  }

  if (durations.length === 0) return 0;

  const sorted = durations.map(Number).sort((a, b) => a - b);
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

/**
 * Get average duration for step
 */
export async function getAvgDuration(step) {
  const key = `${METRICS_PREFIX}:${step}:duration`;
  let durations = [];
  try {
    durations = await redis.lrange(key, 0, 9999);
  } catch (err) {
    logger.warn({ msg: 'Avg duration read failed', step, err: err.message });
    return 0;
  }

  if (durations.length === 0) return 0;

  const sum = durations.reduce((acc, d) => acc + parseInt(d, 10), 0);
  return Math.round(sum / durations.length);
}

/**
 * Get step metrics
 */
async function getStepMetrics(step, metric) {
  const key = `${METRICS_PREFIX}:${step}:${metric}`;
  try {
    const value = await redis.get(key);
    return { [metric]: parseInt(value, 10) || 0 };
  } catch (err) {
    logger.warn({ msg: 'Step metrics read failed', step, err: err.message });
    return { [metric]: 0 };
  }
}

/**
 * Get overall pipeline metrics
 */
export async function getPipelineMetrics() {
  const steps = [
    'CREATE',
    'CONFIRM',
    'PAYMENT_PENDING',
    'ADVANCE_RECEIVED',
    'TOKEN_GENERATED',
    'CARD_DESIGN',
    'CARD_DESIGN_READY',
    'DESIGN_APPROVED',
    'SENT_TO_VENDOR',
    'PRINTING',
    'PRINT_COMPLETE',
    'SHIPPED',
    'OUT_FOR_DELIVERY',
    'DELIVERED',
    'BALANCE_PENDING',
    'COMPLETED',
    'CANCELLED',
    'REFUNDED',
  ];

  const metrics = {};
  let totalOrders = 0;
  let completedOrders = 0;

  await Promise.all(
    steps.map(async step => {
      const stepMetrics = await getStepMetrics(step, 'total');
      metrics[step] = stepMetrics;

      if (step === 'COMPLETED') {
        const completed = await redis.get(`${METRICS_PREFIX}:${step}:total`);
        completedOrders = parseInt(completed, 10) || 0;
      }
      if (step === 'CREATE') {
        const created = await redis.get(`${METRICS_PREFIX}:${step}:total`);
        totalOrders = parseInt(created, 10) || 0;
      }
    })
  );

  return {
    steps: metrics,
    summary: {
      totalOrders,
      completedOrders,
      completionRate: totalOrders > 0 ? ((completedOrders / totalOrders) * 100).toFixed(2) : 0,
      activeOrders: totalOrders - completedOrders,
    },
  };
}
