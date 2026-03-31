// =============================================================================
// orchestrator/orchestrator.constants.js — RESQID PHASE 1
// Shared constants for queues, jobs, Redis keys, retry config, etc.
// =============================================================================

// Queue names (used in queue.config.js and workers)
export const QUEUE_NAMES = Object.freeze({
  EMERGENCY_ALERTS: 'emergencyAlertsQueue',
  NOTIFICATIONS_NORMAL: 'notificationsNormalQueue',
  JOBS_BACKGROUND: 'jobsBackgroundQueue',
  DLQ: 'deadLetterQueue',
});

// Job names (used in retry.service.js, dlq.handler.js, etc.)
export const JOB_NAMES = Object.freeze({
  DLQ_PROCESS: 'dlqProcessJob',
});

// Redis key builders
export const REDIS_KEYS = {
  STATE: orderId => `order:${orderId}:state`,
  IDEMPOTENCY: (orderId, step) => `order:${orderId}:idempotency:${step}`,
  LOCK: (orderId, step) => `order:${orderId}:lock:${step}`,
  DLQ_COUNT: orderId => `order:${orderId}:dlqCount`,
};

// Retry configuration
export const RETRY_CONFIG = Object.freeze({
  MAX_ATTEMPTS: 5,
  BACKOFF_DELAY_MS: 500, // base delay for exponential backoff
});

// Distributed lock TTL
export const DISTRIBUTED_LOCK_TTL_MS = 30_000; // 30 seconds

// Idempotency key TTL — how long we remember a completed step to prevent re-runs
export const IDEMPOTENCY_TTL_SECONDS = 86_400; // 24 hours
