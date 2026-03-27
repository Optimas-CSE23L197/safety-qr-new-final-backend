// =============================================================================
// queues/queue.config.js
// BullMQ queue configuration and connection settings.
// =============================================================================

import { redis } from '#config/database/redis.js';

// Shared BullMQ connection config
export const QUEUE_CONNECTION = {
  client: redis,
  // Optional: Redis cluster support
  // cluster: redis.cluster,
};

// Default job options for all queues
export const DEFAULT_JOB_OPTIONS = {
  removeOnComplete: { count: 100 }, // Keep last 100 completed jobs
  removeOnFail: false, // Keep all failed jobs for debugging
  attempts: 3, // Default retry attempts
  backoff: {
    type: 'exponential',
    delay: 2000,
  },
};

// Queue-specific configurations
export const QUEUE_CONFIGS = {
  pipeline_queue: {
    defaultJobOptions: {
      ...DEFAULT_JOB_OPTIONS,
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      timeout: 300000, // 5 minutes timeout for pipeline jobs
    },
    settings: {
      stalledInterval: 30000, // Check stalled jobs every 30s
      maxStalledCount: 3, // Mark as stalled after 3 checks
      lockDuration: 60000, // Lock for 60s
      lockRenewTime: 15000, // Renew lock every 15s
    },
  },

  token_queue: {
    defaultJobOptions: {
      ...DEFAULT_JOB_OPTIONS,
      attempts: 5,
      backoff: { type: 'exponential', delay: 5000 },
      timeout: 600000, // 10 minutes for token generation
    },
    settings: {
      stalledInterval: 60000,
      maxStalledCount: 5,
      lockDuration: 300000, // 5 min lock for heavy token jobs
      lockRenewTime: 30000,
    },
  },

  notification_queue: {
    defaultJobOptions: {
      ...DEFAULT_JOB_OPTIONS,
      attempts: 5,
      backoff: { type: 'exponential', delay: 1000 },
      timeout: 30000, // 30 seconds for notifications
    },
    settings: {
      stalledInterval: 15000,
      maxStalledCount: 3,
      lockDuration: 30000,
    },
  },

  dlq_queue: {
    defaultJobOptions: {
      ...DEFAULT_JOB_OPTIONS,
      attempts: 1, // DLQ jobs processed once (manual intervention)
      removeOnFail: true, // Don't keep failed DLQ jobs
    },
    settings: {
      stalledInterval: 60000,
      maxStalledCount: 2,
      lockDuration: 120000,
    },
  },
};

/**
 * Get queue configuration for a specific queue name
 * @param {string} queueName
 * @returns {object}
 */
export const getQueueConfig = queueName => {
  return (
    QUEUE_CONFIGS[queueName] || {
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
      settings: {
        stalledInterval: 30000,
        maxStalledCount: 3,
        lockDuration: 60000,
      },
    }
  );
};

/**
 * Validate queue configuration
 */
export const validateQueueConfig = () => {
  const requiredQueues = ['pipeline_queue', 'token_queue', 'notification_queue', 'dlq_queue'];
  const missing = requiredQueues.filter(q => !QUEUE_CONFIGS[q]);

  if (missing.length) {
    throw new Error(`Missing queue configurations for: ${missing.join(', ')}`);
  }

  return true;
};
