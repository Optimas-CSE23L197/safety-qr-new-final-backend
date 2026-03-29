// =============================================================================
// orchestrator/queues/queue.config.js — RESQID PHASE 1 (Production)
// =============================================================================

import { Queue } from 'bullmq';
import { getQueueConnection } from './queue.connection.js';
import { QUEUE_NAMES } from './queue.names.js';
import { logger } from '#config/logger.js';

/**
 * Create a queue with production-grade config
 */
const makeQueue = (name, customOptions = {}) => {
  const connection = getQueueConnection();

  const defaultOptions = {
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
      removeOnComplete: { age: 86400, count: 1000 }, // Keep 24h or 1000 jobs
      removeOnFail: { age: 604800, count: 5000 }, // Keep 7 days or 5000 failed jobs
    },
    connection,
  };

  // ✅ Merge carefully to avoid overwriting nested objects incorrectly
  const queue = new Queue(name, {
    ...defaultOptions,
    ...customOptions,
    defaultJobOptions: {
      ...defaultOptions.defaultJobOptions,
      ...(customOptions.defaultJobOptions || {}),
    },
  });

  logger.info({ queueName: name }, '[queue.config] Queue initialized');
  return queue;
};

// =============================================================================
// PHASE 1 QUEUES
// =============================================================================

export const emergencyAlertsQueue = makeQueue(QUEUE_NAMES.EMERGENCY_ALERTS, {
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 500 },
    timeout: 8000, // ✅ Increased from 5000 → 8000ms to reduce false failures
    priority: 1,
  },
});

export const notificationsQueue = makeQueue(QUEUE_NAMES.NOTIFICATIONS, {
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    timeout: 15000,
    priority: 2,
  },
});

export const backgroundJobsQueue = makeQueue(QUEUE_NAMES.BACKGROUND_JOBS, {
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    timeout: 300000,
    priority: 3,
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
};

export const getQueueByName = name => {
  const queue = allQueues[name];
  if (!queue) {
    throw new Error(`Queue not found: ${name}`);
  }
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
