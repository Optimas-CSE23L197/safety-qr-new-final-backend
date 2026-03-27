// =============================================================================
// services/retry.service.js
// Retry logic for pipeline steps.
// Workers use this to decide whether to retry or send to DLQ.
// =============================================================================

import { logger } from '#config/logger.js';
import { redis } from '#config/database/redis.js';
import { REDIS_KEYS, RETRY_CONFIG } from './orchestrator.constants.js';
import { getQueue } from './queues/queue.manager.js';
import { QUEUE_NAMES, JOB_NAMES } from './orchestrator.constants.js';

/**
 * Determine if a failed job should be retried or sent to DLQ.
 *
 * @param {object} job      - BullMQ job object
 * @returns {{ retry: boolean, exhausted: boolean }}
 */
export function shouldRetry(job) {
  const attempts = job.attemptsMade ?? 0;
  const max = job.opts?.attempts ?? RETRY_CONFIG.MAX_ATTEMPTS;

  return {
    retry: attempts < max,
    exhausted: attempts >= max,
  };
}

/**
 * Calculate backoff delay for next retry attempt (exponential).
 * @param {number} attemptNumber - 1-based attempt count
 * @returns {number} ms to wait
 */
export function calcBackoffDelay(attemptNumber) {
  const base = RETRY_CONFIG.BACKOFF_DELAY_MS;
  const delay = base * Math.pow(2, attemptNumber - 1);
  // Cap at 5 minutes
  return Math.min(delay, 5 * 60 * 1000);
}

/**
 * Send a failed job to the DLQ for manual review.
 * Also logs to DB via the DLQ handler.
 *
 * @param {object} job
 * @param {Error}  error
 */
export async function sendToDLQ(job, error) {
  const dlqQueue = getQueue(QUEUE_NAMES.DLQ);

  const dlqPayload = {
    originalQueue: job.queueName,
    originalJobId: job.id,
    originalJobName: job.name,
    originalData: job.data,
    error: error?.message || String(error),
    stack: error?.stack,
    attemptsMade: job.attemptsMade,
    failedAt: new Date().toISOString(),
  };

  await dlqQueue.add(JOB_NAMES.DLQ_PROCESS, dlqPayload, {
    jobId: `dlq:${job.id}:${Date.now()}`,
    attempts: 1, // DLQ jobs are processed once (manual fix path)
    removeOnComplete: { count: 500 },
    removeOnFail: false,
  });

  // Increment DLQ count for this order (for dashboards)
  if (job.data?.orderId) {
    await redis.incr(REDIS_KEYS.DLQ_COUNT(job.data.orderId));
    await redis.expire(REDIS_KEYS.DLQ_COUNT(job.data.orderId), 86400 * 7); // 7d TTL
  }

  logger.error({
    msg: 'Job sent to DLQ',
    jobId: job.id,
    jobName: job.name,
    orderId: job.data?.orderId,
    error: error?.message,
    attemptsMade: job.attemptsMade,
  });
}

/**
 * Standard error handler for workers — call in the catch block.
 * Logs, decides retry vs DLQ.
 */
export async function handleWorkerFailure(job, error) {
  const { exhausted } = shouldRetry(job);

  logger.error({
    msg: 'Worker job failed',
    jobId: job.id,
    jobName: job.name,
    orderId: job.data?.orderId,
    attempt: job.attemptsMade,
    exhausted,
    error: error?.message,
  });

  if (exhausted) {
    await sendToDLQ(job, error);
  }

  // Always re-throw so BullMQ can handle retry scheduling
  throw error;
}
