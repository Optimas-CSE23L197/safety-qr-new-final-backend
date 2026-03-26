// =============================================================================
// dlq/dlq.queue.js
// Dead Letter Queue management and processing.
// =============================================================================

import { getQueue } from "../queues/queue.manager.js";
import {
  QUEUE_NAMES,
  JOB_NAMES,
  RETRY_CONFIG,
} from "../orchestrator.constants.js";
import { logger } from "../../../config/logger.js";

/**
 * Add a failed job to DLQ
 */
export async function addToDLQ(originalJob, error, metadata = {}) {
  const dlqQueue = getQueue(QUEUE_NAMES.DLQ);

  const dlqPayload = {
    originalQueue: originalJob.queueName,
    originalJobId: originalJob.id,
    originalJobName: originalJob.name,
    originalData: originalJob.data,
    error: {
      message: error.message,
      stack: error.stack,
      name: error.name,
    },
    attemptsMade: originalJob.attemptsMade || 0,
    maxAttempts: originalJob.opts?.attempts || RETRY_CONFIG.MAX_ATTEMPTS,
    failedAt: new Date().toISOString(),
    metadata,
  };

  const dlqJob = await dlqQueue.add(JOB_NAMES.DLQ_PROCESS, dlqPayload, {
    jobId: `dlq:${originalJob.id}:${Date.now()}`,
    attempts: 1,
    removeOnComplete: { count: 500 },
    removeOnFail: false,
    backoff: {
      type: "exponential",
      delay: 5000,
    },
  });

  logger.error({
    msg: "Job added to DLQ",
    originalJobId: originalJob.id,
    originalJobName: originalJob.name,
    dlqJobId: dlqJob.id,
    orderId: originalJob.data?.orderId,
    error: error.message,
    attemptsMade: originalJob.attemptsMade,
  });

  return dlqJob;
}

/**
 * Replay a job from DLQ back to original queue
 */
export async function replayFromDLQ(
  dlqEntryId,
  dlqQueue,
  originalQueue,
  originalJobName,
  originalData,
  options = {},
) {
  const queue = getQueue(originalQueue);

  const job = await queue.add(originalJobName, originalData, {
    jobId: `${originalJobName}:replay:${dlqEntryId}:${Date.now()}`,
    attempts: options.attempts || RETRY_CONFIG.MAX_ATTEMPTS,
    backoff: {
      type: "exponential",
      delay: RETRY_CONFIG.BACKOFF_DELAY_MS,
    },
    ...options,
  });

  logger.info({
    msg: "Job replayed from DLQ",
    dlqEntryId,
    originalQueue,
    originalJobName,
    newJobId: job.id,
  });

  return job;
}

/**
 * Get DLQ statistics
 */
export async function getDLQStats() {
  const dlqQueue = getQueue(QUEUE_NAMES.DLQ);

  const [waiting, active, failed, delayed, completed] = await Promise.all([
    dlqQueue.getWaitingCount(),
    dlqQueue.getActiveCount(),
    dlqQueue.getFailedCount(),
    dlqQueue.getDelayedCount(),
    dlqQueue.getCompletedCount(),
  ]);

  return {
    waiting,
    active,
    failed,
    delayed,
    completed,
    total: waiting + active + failed + delayed + completed,
  };
}

/**
 * Clear completed jobs from DLQ
 */
export async function clearCompletedDLQ() {
  const dlqQueue = getQueue(QUEUE_NAMES.DLQ);
  await dlqQueue.clean(0, 1000, "completed");
  logger.info({ msg: "Cleared completed jobs from DLQ" });
}

/**
 * Retry all failed DLQ jobs
 */
export async function retryAllFailedDLQ() {
  const dlqQueue = getQueue(QUEUE_NAMES.DLQ);
  const failedJobs = await dlqQueue.getFailed();

  for (const job of failedJobs) {
    await job.retry();
    logger.info({ msg: "Retrying DLQ job", jobId: job.id });
  }

  return { retried: failedJobs.length };
}
