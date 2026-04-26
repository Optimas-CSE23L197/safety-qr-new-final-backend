// =============================================================================
// orchestrator/queues/queue.config.js — RESQID
//
// RAILWAY (24/7):  emergencyAlertsQueue + notificationsQueue
// LOCAL ONLY:      pipelineJobsQueue (npm run worker:pipeline)
//
// Notes:
//   - backgroundJobsQueue removed (invoice + maintenance are direct calls now)
//   - getQueueConnection() returns a config object, not a shared instance —
//     BullMQ calls .duplicate() internally; shared instances cause leaks
//   - stalledInterval + maxStalledCount belong on Worker, NOT Queue — set them
//     in each new Worker(...) constructor in your worker files
//   - keepAlive: 300_000 set in queue.connection.js (5 min, not 30s)
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
      removeOnComplete: { age: 86400, count: 1000 },
      removeOnFail: { age: 604800, count: 5000 },
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
// RAILWAY QUEUES — always on
// =============================================================================

export const emergencyAlertsQueue = makeQueue(QUEUE_NAMES.EMERGENCY_ALERTS, {
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 500 },
    removeOnComplete: { age: 86400, count: 500 },
    removeOnFail: { age: 604800, count: 2000 },
  },
});

export const notificationsQueue = makeQueue(QUEUE_NAMES.NOTIFICATIONS, {
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: { age: 86400, count: 1000 },
    removeOnFail: { age: 604800, count: 5000 },
  },
});

// =============================================================================
// LOCAL-ONLY QUEUE — npm run worker:pipeline (never deployed on Railway)
// Only instantiated when ENABLE_PIPELINE_QUEUE=true
// Prevents Railway from opening a Redis connection to a queue nobody consumes
// =============================================================================

export const pipelineJobsQueue =
  process.env.ENABLE_PIPELINE_QUEUE === 'true'
    ? makeQueue(QUEUE_NAMES.PIPELINE_JOBS, {
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: { age: 86400, count: 500 },
          removeOnFail: { age: 604800, count: 2000 },
        },
      })
    : null;

// =============================================================================
// QUEUE REGISTRY — only include instantiated queues
// =============================================================================

export const allQueues = {
  [QUEUE_NAMES.EMERGENCY_ALERTS]: emergencyAlertsQueue,
  [QUEUE_NAMES.NOTIFICATIONS]: notificationsQueue,
  ...(pipelineJobsQueue ? { [QUEUE_NAMES.PIPELINE_JOBS]: pipelineJobsQueue } : {}),
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
