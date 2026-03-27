// =============================================================================
// orchestrator.constants.js — RESQID Order Orchestrator
// =============================================================================

export const ORCHESTRATOR_VERSION = '1.0.0';

export const QUEUE_NAMES = {
  PIPELINE: 'pipeline_queue',
  TOKEN: 'token_queue',
  NOTIFICATION: 'notification_queue',
  DLQ: 'dlq_queue',
};

export const WORKER_CONCURRENCY = {
  PIPELINE: 5,
  TOKEN: 3, // heavy CPU/IO — keep lower
  NOTIFICATION: 10,
  DLQ: 2,
};

export const JOB_NAMES = {
  APPROVAL: 'order.approval',
  PAYMENT: 'order.payment',
  TOKEN: 'order.token',
  CARD: 'order.card',
  DESIGN: 'order.design',
  VENDOR: 'order.vendor',
  PRINTING: 'order.printing',
  SHIPMENT: 'order.shipment',
  DELIVERY: 'order.delivery',
  COMPLETION: 'order.completion',
  CANCEL: 'order.cancel',
  FAILURE: 'order.failure',
  NOTIFY: 'notify.send',
  DLQ_PROCESS: 'dlq.process',
};

export const IDEMPOTENCY_TTL_SECONDS = 86400; // 24h

export const DISTRIBUTED_LOCK_TTL_MS = 30_000; // 30s

export const RETRY_CONFIG = {
  MAX_ATTEMPTS: 3,
  BACKOFF_TYPE: 'exponential',
  BACKOFF_DELAY_MS: 2_000,
  DLQ_AFTER_ATTEMPTS: 3,
};

export const STALL_THRESHOLD_MS = 30 * 60 * 1000; // 30 min

// Redis key prefixes
export const REDIS_KEYS = {
  IDEMPOTENCY: (orderId, step) => `orch:idem:${orderId}:${step}`,
  LOCK: (orderId, step) => `orch:lock:${orderId}:${step}`,
  STATE: orderId => `orch:state:${orderId}`,
  DLQ_COUNT: orderId => `orch:dlq:count:${orderId}`,
};

// Add this to orchestrator.constants.js

export const MANUAL_PHASES = {
  1: { name: 'CONFIRM', step: 'CONFIRM', status: 'PENDING' },
  2: { name: 'ADVANCE_INVOICE', step: 'ADVANCE_INVOICE', status: 'PENDING' },
  3: { name: 'ADVANCE_PAYMENT', step: 'ADVANCE_PAYMENT', status: 'PENDING' },
  4: { name: 'TOKEN_GENERATION', step: 'TOKEN_GENERATION', status: 'PENDING' },
  5: { name: 'CARD_DESIGN', step: 'CARD_DESIGN', status: 'PENDING' },
  6: {
    name: 'VENDOR_ASSIGNMENT',
    step: 'VENDOR_ASSIGNMENT',
    status: 'PENDING',
  },
  7: { name: 'PRINTING', step: 'PRINTING', status: 'PENDING' },
  8: { name: 'SHIPMENT', step: 'SHIPMENT', status: 'PENDING' },
  9: { name: 'DELIVERY', step: 'DELIVERY', status: 'PENDING' },
  10: { name: 'BALANCE_PAYMENT', step: 'BALANCE_PAYMENT', status: 'PENDING' },
};
