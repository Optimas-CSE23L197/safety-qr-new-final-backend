// =============================================================================
// orchestrator/queues/queue.config.js — RESQID PHASE 1
// FIX [Q-1]: Removed invalid `timeout` field from defaultJobOptions.
//            BullMQ does not support timeout here — it was silently ignored.
//            Per-channel timeouts are enforced inside workers via Promise.race.
// FIX [Q-2]: Removed `priority` from defaultJobOptions — priority is a per-job
//            option set in event.publisher.js getJobOptions(), not queue-level.
//            Setting it here would override per-job priority on every add().
// =============================================================================

import { Queue } from 'bullmq';
import { getQueueConnection } from './queue.connection.js';
import { QUEUE_NAMES } from './queue.names.js';
import { logger } from '#config/logger.js';

const makeQueue = (name, customOptions = {}) => {
  const connection = getQueueConnection();

  const defaultOptions = {
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: { age: 86400, count: 1000 }, // 24h or 1000 jobs
      removeOnFail: { age: 604800, count: 5000 }, // 7 days or 5000 jobs
    },
    connection,
  };

  const queue = new Queue(name, {
    ...defaultOptions,
    ...customOptions,
    defaultJobOptions: {
      ...defaultOptions.defaultJobOptions,
      ...(customOptions.defaultJobOptions ?? {}),
    },
  });

  logger.info({ queueName: name }, '[queue.config] Queue initialized');
  return queue;
};

// =============================================================================
// PHASE 1 QUEUES
// =============================================================================

// Sacred pipeline — isolated, highest priority, aggressive retry
export const emergencyAlertsQueue = makeQueue(QUEUE_NAMES.EMERGENCY_ALERTS, {
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 500 },
    // No timeout here — emergency.worker.js enforces per-channel timeouts
    // via Promise.race (push: 2s, SMS: 4s, WA: 4s)
    removeOnComplete: { age: 86400, count: 500 },
    removeOnFail: { age: 604800, count: 2000 },
  },
});

// Order lifecycle, school notifications — can tolerate a few seconds latency
export const notificationsQueue = makeQueue(QUEUE_NAMES.NOTIFICATIONS, {
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    // No timeout here — notification.worker.js delegates to channel functions
    // which have their own provider-level timeouts via axios/fcm SDK
  },
});

// Token generation, card design, invoice, maintenance — long-running jobs
export const backgroundJobsQueue = makeQueue(QUEUE_NAMES.BACKGROUND_JOBS, {
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { age: 86400, count: 500 },
    removeOnFail: { age: 604800, count: 2000 },
  },
});

export const pipelineJobsQueue = makeQueue(QUEUE_NAMES.PIPELINE_JOBS, {
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { age: 86400, count: 500 },
    removeOnFail: { age: 604800, count: 2000 },
  },
});

// =============================================================================
// QUEUE REGISTRY
// =============================================================================

export const allQueues = {
  [QUEUE_NAMES.EMERGENCY_ALERTS]: emergencyAlertsQueue,
  [QUEUE_NAMES.NOTIFICATIONS]: notificationsQueue,
  [QUEUE_NAMES.BACKGROUND_JOBS]: backgroundJobsQueue,
  [QUEUE_NAMES.PIPELINE_JOBS]: pipelineJobsQueue,
};

export const getQueueByName = name => {
  const queue = allQueues[name];
  if (!queue) throw new Error(`[queue.config] Queue not found: ${name}`);
  return queue;
};

export const closeAllQueues = async () => {
  for (const [name, queue] of Object.entries(allQueues)) {
    await queue.close();
    logger.info({ queueName: name }, '[queue.config] Queue closed');
  }
};

export const getAllQueueMetrics = async () => {
  const metrics = {};
  for (const [name, queue] of Object.entries(allQueues)) {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getCompletedCount(),
      queue.getFailedCount(),
      queue.getDelayedCount(),
    ]);
    metrics[name] = { waiting, active, completed, failed, delayed };
  }
  return metrics;
};
