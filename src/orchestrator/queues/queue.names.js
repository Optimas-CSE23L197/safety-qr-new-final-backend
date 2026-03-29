// =============================================================================
// orchestrator/queues/queue.names.js — RESQID PHASE 1 (Production)
// =============================================================================

export const QUEUE_NAMES = Object.freeze({
  // PHASE 1 QUEUES
  EMERGENCY_ALERTS: 'queue:emergency_alerts', // Emergency service → Emergency Worker
  NOTIFICATIONS: 'queue:notifications', // Any service → Notification Worker
  BACKGROUND_JOBS: 'queue:background_jobs', // Maintenance/Invoice → Maintenance + Invoice Worker

  // Aliases for backward compatibility
  CRITICAL: 'queue:emergency_alerts',
  BACKGROUND: 'queue:background_jobs',
  ORDER: 'queue:background_jobs',

  // ✅ Added explicit alias for background jobs used by pipeline/design workers
  JOBS_BACKGROUND: 'queue:background_jobs',
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
