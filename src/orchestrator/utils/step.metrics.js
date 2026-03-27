// =============================================================================
// utils/step.metrics.js
// Complete metrics collection for pipeline steps with aggregation.
// =============================================================================

import { redis } from '#config/redis.js';
import { logger } from '#config/logger.js';

const METRICS_PREFIX = 'orch:metrics';
const RETENTION_DAYS = 30;
const DETAIL_RETENTION_HOURS = 24;

/**
 * Record step execution metric
 */
export async function recordMetric(step, orderId, durationMs, status, metadata = {}) {
  const timestamp = new Date();
  const hour = timestamp.toISOString().slice(0, 13);
  const day = timestamp.toISOString().slice(0, 10);
  const minute = timestamp.toISOString().slice(0, 16);

  const keys = {
    // Total counters
    total: `${METRICS_PREFIX}:${step}:total`,
    success: `${METRICS_PREFIX}:${step}:success`,
    failure: `${METRICS_PREFIX}:${step}:failure`,
    duration: `${METRICS_PREFIX}:${step}:duration`,

    // Time-based aggregations
    hourly: `${METRICS_PREFIX}:${step}:hourly:${hour}`,
    daily: `${METRICS_PREFIX}:${step}:daily:${day}`,
    minute: `${METRICS_PREFIX}:${step}:minute:${minute}`,

    // Order-specific (for debugging)
    order: `${METRICS_PREFIX}:order:${orderId}`,
  };

  const pipeline = redis.pipeline();

  // Increment total counters
  pipeline.incr(keys.total);
  pipeline.expire(keys.total, 86400 * RETENTION_DAYS);

  if (status === 'success') {
    pipeline.incr(keys.success);
    pipeline.expire(keys.success, 86400 * RETENTION_DAYS);
  } else {
    pipeline.incr(keys.failure);
    pipeline.expire(keys.failure, 86400 * RETENTION_DAYS);
  }

  // Track duration (for percentile calculations)
  pipeline.lpush(keys.duration, durationMs);
  pipeline.ltrim(keys.duration, 0, 9999);
  pipeline.expire(keys.duration, 86400 * RETENTION_DAYS);

  // Minute aggregation (for real-time)
  pipeline.hincrby(keys.minute, 'total', 1);
  if (status === 'success') {
    pipeline.hincrby(keys.minute, 'success', 1);
  } else {
    pipeline.hincrby(keys.minute, 'failure', 1);
  }
  pipeline.hincrby(keys.minute, 'duration', durationMs);
  pipeline.expire(keys.minute, 3600 * DETAIL_RETENTION_HOURS);

  // Hourly aggregation
  pipeline.hincrby(keys.hourly, 'total', 1);
  if (status === 'success') {
    pipeline.hincrby(keys.hourly, 'success', 1);
  } else {
    pipeline.hincrby(keys.hourly, 'failure', 1);
  }
  pipeline.hincrby(keys.hourly, 'duration', durationMs);
  pipeline.expire(keys.hourly, 86400 * 2);

  // Daily aggregation
  pipeline.hincrby(keys.daily, 'total', 1);
  if (status === 'success') {
    pipeline.hincrby(keys.daily, 'success', 1);
  } else {
    pipeline.hincrby(keys.daily, 'failure', 1);
  }
  pipeline.hincrby(keys.daily, 'duration', durationMs);
  pipeline.expire(keys.daily, 86400 * RETENTION_DAYS);

  // Order-specific metrics (keep last 100)
  pipeline.lpush(
    keys.order,
    JSON.stringify({
      step,
      durationMs,
      status,
      metadata,
      timestamp: timestamp.toISOString(),
    })
  );
  pipeline.ltrim(keys.order, 0, 99);
  pipeline.expire(keys.order, 86400 * 7);

  await pipeline.exec();

  logger.debug({
    msg: 'Step metric recorded',
    step,
    orderId,
    durationMs,
    status,
  });
}

/**
 * Get step metrics with percentiles
 */
export async function getStepMetrics(step, period = 'hour') {
  const now = new Date();
  const keys = {};

  if (period === 'minute') {
    const minute = now.toISOString().slice(0, 16);
    keys.metrics = `${METRICS_PREFIX}:${step}:minute:${minute}`;
  } else if (period === 'hour') {
    const hour = now.toISOString().slice(0, 13);
    keys.metrics = `${METRICS_PREFIX}:${step}:hourly:${hour}`;
  } else if (period === 'day') {
    const day = now.toISOString().slice(0, 10);
    keys.metrics = `${METRICS_PREFIX}:${step}:daily:${day}`;
  } else if (period === 'week') {
    // Aggregate last 7 days
    const days = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      days.push(`${METRICS_PREFIX}:${step}:daily:${date.toISOString().slice(0, 10)}`);
    }
    keys.metrics = days;
  } else if (period === 'month') {
    // Aggregate last 30 days
    const days = [];
    for (let i = 0; i < 30; i++) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      days.push(`${METRICS_PREFIX}:${step}:daily:${date.toISOString().slice(0, 10)}`);
    }
    keys.metrics = days;
  } else {
    // Default: get total counters
    const [total, success, failure, avgDuration, p50, p95, p99] = await Promise.all([
      redis.get(`${METRICS_PREFIX}:${step}:total`),
      redis.get(`${METRICS_PREFIX}:${step}:success`),
      redis.get(`${METRICS_PREFIX}:${step}:failure`),
      getAvgDuration(step),
      getPercentile(step, 50),
      getPercentile(step, 95),
      getPercentile(step, 99),
    ]);

    return {
      total: parseInt(total || '0', 10),
      success: parseInt(success || '0', 10),
      failure: parseInt(failure || '0', 10),
      successRate: total
        ? ((parseInt(success || '0', 10) / parseInt(total, 10)) * 100).toFixed(2)
        : 0,
      avgDurationMs: avgDuration,
      p50Ms: p50,
      p95Ms: p95,
      p99Ms: p99,
    };
  }

  if (Array.isArray(keys.metrics)) {
    // Aggregate multiple days
    let total = 0;
    let success = 0;
    let failure = 0;
    let totalDuration = 0;

    for (const key of keys.metrics) {
      const data = await redis.hgetall(key);
      total += parseInt(data.total || '0', 10);
      success += parseInt(data.success || '0', 10);
      failure += parseInt(data.failure || '0', 10);
      totalDuration += parseInt(data.duration || '0', 10);
    }

    return {
      total,
      success,
      failure,
      successRate: total > 0 ? ((success / total) * 100).toFixed(2) : 0,
      avgDurationMs: success > 0 ? Math.round(totalDuration / success) : 0,
    };
  }

  const data = await redis.hgetall(keys.metrics);
  const total = parseInt(data.total || '0', 10);
  const success = parseInt(data.success || '0', 10);
  const totalDuration = parseInt(data.duration || '0', 10);

  return {
    total,
    success,
    failure: parseInt(data.failure || '0', 10),
    successRate: total > 0 ? ((success / total) * 100).toFixed(2) : 0,
    avgDurationMs: success > 0 ? Math.round(totalDuration / success) : 0,
  };
}

/**
 * Get percentile for step duration
 */
async function getPercentile(step, percentile) {
  const key = `${METRICS_PREFIX}:${step}:duration`;
  const durations = await redis.lrange(key, 0, 9999);

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
  const durations = await redis.lrange(key, 0, 9999);

  if (durations.length === 0) return 0;

  const sum = durations.reduce((acc, d) => acc + parseInt(d, 10), 0);
  return Math.round(sum / durations.length);
}

/**
 * Get overall pipeline metrics
 */
export async function getPipelineMetrics() {
  const steps = [
    'CREATE',
    'CONFIRM',
    'ADVANCE_INVOICE',
    'ADVANCE_PAYMENT',
    'TOKEN_GENERATION',
    'CARD_DESIGN',
    'VENDOR_DISPATCH',
    'PRINTING_START',
    'PRINTING_DONE',
    'SHIPMENT_CREATE',
    'SHIPMENT_SHIPPED',
    'DELIVERY',
    'BALANCE_INVOICE',
    'BALANCE_PAYMENT',
  ];

  const metrics = {};
  let totalOrders = 0;
  let completedOrders = 0;

  for (const step of steps) {
    const stepMetrics = await getStepMetrics(step, 'total');
    metrics[step] = stepMetrics;

    if (step === 'BALANCE_PAYMENT') {
      completedOrders = stepMetrics.success || 0;
    }
    if (step === 'CREATE') {
      totalOrders = stepMetrics.total || 0;
    }
  }

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

/**
 * Get real-time metrics for dashboard
 */
export async function getRealTimeMetrics() {
  const now = new Date();
  const currentMinute = now.toISOString().slice(0, 16);
  const currentHour = now.toISOString().slice(0, 13);

  const keys = await redis.keys(`${METRICS_PREFIX}:*:minute:${currentMinute}`);

  const metrics = {
    timestamp: now.toISOString(),
    minute: {},
    hour: {},
    summary: {
      totalSteps: 0,
      successSteps: 0,
      failedSteps: 0,
    },
  };

  for (const key of keys) {
    const step = key.split(':')[2];
    const data = await redis.hgetall(key);

    metrics.minute[step] = {
      total: parseInt(data.total || '0', 10),
      success: parseInt(data.success || '0', 10),
      failure: parseInt(data.failure || '0', 10),
      avgDurationMs: data.success
        ? Math.round(parseInt(data.duration, 10) / parseInt(data.success, 10))
        : 0,
    };

    metrics.summary.totalSteps += metrics.minute[step].total;
    metrics.summary.successSteps += metrics.minute[step].success;
    metrics.summary.failedSteps += metrics.minute[step].failure;
  }

  return metrics;
}

/**
 * Reset metrics (for testing)
 */
export async function resetMetrics(step = null) {
  if (step) {
    const pattern = `${METRICS_PREFIX}:${step}:*`;
    const keys = await redis.keys(pattern);
    if (keys.length) {
      await redis.del(keys);
    }
  } else {
    const keys = await redis.keys(`${METRICS_PREFIX}:*`);
    if (keys.length) {
      await redis.del(keys);
    }
  }

  logger.info({ msg: 'Metrics reset', step });
}

/**
 * Export metrics to CSV format
 */
export async function exportMetrics(step, period = 'day', limit = 100) {
  const metrics = [];
  const now = new Date();

  for (let i = 0; i < limit; i++) {
    const date = new Date(now);
    if (period === 'hour') {
      date.setHours(date.getHours() - i);
      const hour = date.toISOString().slice(0, 13);
      const key = `${METRICS_PREFIX}:${step}:hourly:${hour}`;
      const data = await redis.hgetall(key);
      metrics.unshift({
        period: hour,
        total: parseInt(data.total || '0', 10),
        success: parseInt(data.success || '0', 10),
        failure: parseInt(data.failure || '0', 10),
        avgDurationMs: data.success
          ? Math.round(parseInt(data.duration, 10) / parseInt(data.success, 10))
          : 0,
      });
    } else {
      date.setDate(date.getDate() - i);
      const day = date.toISOString().slice(0, 10);
      const key = `${METRICS_PREFIX}:${step}:daily:${day}`;
      const data = await redis.hgetall(key);
      metrics.unshift({
        period: day,
        total: parseInt(data.total || '0', 10),
        success: parseInt(data.success || '0', 10),
        failure: parseInt(data.failure || '0', 10),
        avgDurationMs: data.success
          ? Math.round(parseInt(data.duration, 10) / parseInt(data.success, 10))
          : 0,
      });
    }
  }

  return metrics;
}
