// =============================================================================
// orchestrator/index.js — RESQID
// Clean re-export of everything external code needs from the orchestrator.
// Internal modules import directly from their file — this is for app-level usage.
// =============================================================================

// ── Events ────────────────────────────────────────────────────────────────────
export { EVENTS } from './events/event.types.js';
export { publish } from './events/event.publisher.js';
export { consume, dispatch as dispatchEvent, hasHandlers } from './events/event.consumer.js';

// ── Queues ────────────────────────────────────────────────────────────────────
export { QUEUE_NAMES } from './queues/queue.names.js';
export {
  emergencyAlertsQueue,
  notificationsQueue,
  backgroundJobsQueue,
  pipelineJobsQueue,
  closeAllQueues,
} from './queues/queue.config.js';

// ── State machine ─────────────────────────────────────────────────────────────
export { ORDER_STATUS, TERMINAL_STATES, ACTIVE_STATES } from './state/order.states.js';
export { TRANSITIONS } from './state/order.transitions.js';
export { canTransition, applyTransition } from './state/order.guards.js';

// ── Job types (for enqueuing background jobs) ─────────────────────────────────
export { JOB_TYPES } from './workers/background.worker.js';

// ── Workers ───────────────────────────────────────────────────────────────────
export { startWorkers } from './workers/index.js';

// ── Scheduler ─────────────────────────────────────────────────────────────────
export { startScheduler, stopScheduler, triggerJob } from './jobs/scheduler.service.js';

// ── DLQ ───────────────────────────────────────────────────────────────────────
export { handleDeadJob, flushDlqSlackBatch } from './dlq/dlq.handler.js';

// ── Policies ─────────────────────────────────────────────────────────────────
export { notifySlack } from './policies/escalation.policy.js';

// ── Notifications ─────────────────────────────────────────────────────────────
export { dispatch as dispatchNotification } from './notifications/notification.dispatcher.js';
