// =============================================================================
// queues/queue.names.js
// Centralized queue name definitions to avoid typos and ensure consistency.
// =============================================================================

export const QUEUE_NAMES = {
  // Main orchestration queue
  PIPELINE: 'pipeline_queue',

  // Specialized queues
  TOKEN: 'token_queue',
  NOTIFICATION: 'notification_queue',
  DLQ: 'dlq_queue',

  // Additional queues for future scaling
  CARD_DESIGN: 'card_design_queue',
  SHIPMENT: 'shipment_queue',
  VENDOR: 'vendor_queue',
  PRINTING: 'printing_queue',
};

export const JOB_NAMES = {
  // Pipeline jobs
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

  // Notification jobs
  NOTIFY: 'notify.send',

  // DLQ jobs
  DLQ_PROCESS: 'dlq.process',
  DLQ_REPROCESS: 'dlq.reprocess',

  // Monitoring jobs
  STALLED_CHECK: 'monitor.stalled',
  METRICS_COLLECT: 'monitor.metrics',
  ESCALATION_CHECK: 'monitor.escalation',
};

/**
 * Get all queue names as an array
 */
export const getAllQueueNames = () => {
  return Object.values(QUEUE_NAMES);
};

/**
 * Get all job names as an array
 */
export const getAllJobNames = () => {
  return Object.values(JOB_NAMES);
};

/**
 * Get queue name for a specific job
 * @param {string} jobName
 * @returns {string}
 */
export const getQueueForJob = jobName => {
  const mapping = {
    [JOB_NAMES.APPROVAL]: QUEUE_NAMES.PIPELINE,
    [JOB_NAMES.PAYMENT]: QUEUE_NAMES.PIPELINE,
    [JOB_NAMES.TOKEN]: QUEUE_NAMES.TOKEN,
    [JOB_NAMES.CARD]: QUEUE_NAMES.PIPELINE,
    [JOB_NAMES.DESIGN]: QUEUE_NAMES.PIPELINE,
    [JOB_NAMES.VENDOR]: QUEUE_NAMES.PIPELINE,
    [JOB_NAMES.PRINTING]: QUEUE_NAMES.PIPELINE,
    [JOB_NAMES.SHIPMENT]: QUEUE_NAMES.PIPELINE,
    [JOB_NAMES.DELIVERY]: QUEUE_NAMES.PIPELINE,
    [JOB_NAMES.COMPLETION]: QUEUE_NAMES.PIPELINE,
    [JOB_NAMES.CANCEL]: QUEUE_NAMES.PIPELINE,
    [JOB_NAMES.FAILURE]: QUEUE_NAMES.PIPELINE,
    [JOB_NAMES.NOTIFY]: QUEUE_NAMES.NOTIFICATION,
    [JOB_NAMES.DLQ_PROCESS]: QUEUE_NAMES.DLQ,
    [JOB_NAMES.DLQ_REPROCESS]: QUEUE_NAMES.DLQ,
  };

  return mapping[jobName] || QUEUE_NAMES.PIPELINE;
};

/**
 * Validate job name exists
 */
export const isValidJobName = jobName => {
  return Object.values(JOB_NAMES).includes(jobName);
};

/**
 * Validate queue name exists
 */
export const isValidQueueName = queueName => {
  return Object.values(QUEUE_NAMES).includes(queueName);
};
