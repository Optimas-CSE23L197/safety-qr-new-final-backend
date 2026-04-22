// =============================================================================
// orchestrator/queues/queue.names.js — RESQID
//
// Phase 1 production queues:
//   - emergency_queue   → EmergencyWorker (Railway, 24/7)
//   - notification_queue → NotificationWorker (Railway, 24/7)
//
// Local-only queues (npm run worker:pipeline / worker:design — local dev only):
//   - pipeline_queue    → PipelineWorker (local until 50 schools)
//
// Removed: background_queue — invoice + maintenance now run as plain functions
// =============================================================================

export const QUEUE_NAMES = Object.freeze({
  EMERGENCY_ALERTS: 'emergency_queue',
  NOTIFICATIONS: 'notification_queue',
  PIPELINE_JOBS: 'pipeline_queue',
});

// Priority mapping (1 = highest)
export const QUEUE_PRIORITIES = {
  [QUEUE_NAMES.EMERGENCY_ALERTS]: 1,
  [QUEUE_NAMES.NOTIFICATIONS]: 2,
  [QUEUE_NAMES.PIPELINE_JOBS]: 3,
};

// SLA targets (milliseconds)
export const QUEUE_SLA_MS = {
  [QUEUE_NAMES.EMERGENCY_ALERTS]: 8000,
  [QUEUE_NAMES.NOTIFICATIONS]: 15000,
  [QUEUE_NAMES.PIPELINE_JOBS]: 600000,
};
