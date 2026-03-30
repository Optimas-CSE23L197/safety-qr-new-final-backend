// =============================================================================
// orchestrator/queues/queue.names.js — RESQID PHASE 1 (Fresh Setup)
// Simple queue names without colons for BullMQ compatibility
// =============================================================================

export const QUEUE_NAMES = Object.freeze({
  // Phase 1 Queues
  EMERGENCY_ALERTS: 'emergency_queue',
  NOTIFICATIONS: 'notification_queue',
  BACKGROUND_JOBS: 'background_queue',

  // Aliases
  CRITICAL: 'emergency_queue',
  BACKGROUND: 'background_queue',
  ORDER: 'background_queue',
  JOBS_BACKGROUND: 'background_queue',
});

// Priority mapping (1 = highest)
export const QUEUE_PRIORITIES = {
  [QUEUE_NAMES.EMERGENCY_ALERTS]: 1,
  [QUEUE_NAMES.NOTIFICATIONS]: 2,
  [QUEUE_NAMES.BACKGROUND_JOBS]: 3,
};

// SLA targets (milliseconds)
export const QUEUE_SLA_MS = {
  [QUEUE_NAMES.EMERGENCY_ALERTS]: 8000,
  [QUEUE_NAMES.NOTIFICATIONS]: 15000,
  [QUEUE_NAMES.BACKGROUND_JOBS]: 300000,
};
