// =============================================================================
// order_orchestrator/index.js
// Main entry point - exports all public APIs.
// =============================================================================

// Main orchestrator functions
export {
  startOrder,
  approveOrder,
  handlePayment,
  cancelOrder,
  getOrderStatus,
  resumeStalledPipeline,
} from "./orchestrator.js";

// Event publisher
export {
  publishEvent,
  publishNotification,
  publishFailure,
} from "./events/event.publisher.js";
export { ORDER_EVENTS } from "./events/event.types.js";

// Event consumer
export {
  handleWebhookEvent,
  advanceStepManually,
} from "./events/event.consumer.js";

// Worker management
export {
  startAllWorkers,
  stopAllWorkers,
  getWorker,
  getAllWorkers,
} from "./workers/index.js";

// Queue management
export {
  initQueues,
  closeQueues,
  getQueue,
  getQueueHealth,
} from "./queues/queue.manager.js";

// DLQ service
export { DlqService, createDlqWorker } from "./dlq/dlq.handler.js";

// State machine
export { ORDER_STATES, STATE_TO_STEP } from "./state/order.states.js";
export {
  validateTransition,
  isTerminalState,
  canCancelFromState,
} from "./state/order.transitions.js";

// Guards
export {
  guardOrderExists,
  guardSuperAdmin,
  guardSchoolAdmin,
  guardNoAdvancePayment,
  guardNoTokens,
  guardNoPrinting,
  guardNotShipped,
  runCancellationGuards,
} from "./state/order.guards.js";

// Services
export {
  getOrderState,
  transitionState,
  markStalled,
} from "./services/state.service.js";

export {
  beginStepExecution,
  completeStepExecution,
  failStepExecution,
  updateStepProgress,
  beginJobExecution,
  completeJobExecution,
  failJobExecution,
} from "./services/execution.service.js";

export {
  claimExecution,
  markCompleted,
  releaseClaim,
  checkStatus,
  acquireLock,
  releaseLock,
} from "./services/idempotency.service.js";

export {
  shouldRetry,
  calcBackoffDelay,
  sendToDLQ,
  handleWorkerFailure,
} from "./services/retry.service.js";

// Policies
export { evaluateCancellation } from "./policies/cancellation.policy.js";
export {
  getRetryPolicy,
  shouldEscalateOnDLQ,
} from "./policies/retry.policy.js";

// Utilities
export { stepLog, stepWarn, stepError } from "./utils/step.logger.js";
export { stepMetrics, recordMetric } from "./utils/step.metrics.js";
export { buildPayload } from "./utils/payload.builder.js";

// Constants
export {
  ORCHESTRATOR_VERSION,
  QUEUE_NAMES,
  WORKER_CONCURRENCY,
  JOB_NAMES,
  IDEMPOTENCY_TTL_SECONDS,
  DISTRIBUTED_LOCK_TTL_MS,
  RETRY_CONFIG,
  STALL_THRESHOLD_MS,
  REDIS_KEYS,
} from "./orchestrator.constants.js";
