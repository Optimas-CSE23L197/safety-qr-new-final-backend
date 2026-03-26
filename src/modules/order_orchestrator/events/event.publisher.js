// =============================================================================
// events/event.publisher.js
// Publishes order lifecycle events as BullMQ jobs.
// This is the ONLY way workers should trigger next steps.
// =============================================================================

import { logger } from "../../../config/logger.js";
import { getQueue } from "../queues/queue.manager.js";
import { QUEUE_NAMES, JOB_NAMES } from "../orchestrator.constants.js";
import { ORDER_EVENTS } from "./event.types.js";

// Maps event → { queue, jobName } so the publisher knows where to route
// Updated EVENT_ROUTING — skip dead card worker
const EVENT_ROUTING = {
  [ORDER_EVENTS.ORDER_CREATED]: {
    queue: QUEUE_NAMES.PIPELINE,
    job: JOB_NAMES.APPROVAL,
  },
  [ORDER_EVENTS.ORDER_APPROVED]: {
    queue: QUEUE_NAMES.PIPELINE,
    job: JOB_NAMES.PAYMENT,
  },
  [ORDER_EVENTS.ADVANCE_PAYMENT_REQUESTED]: {
    queue: QUEUE_NAMES.NOTIFICATION,
    job: JOB_NAMES.NOTIFY,
  },
  [ORDER_EVENTS.ADVANCE_PAYMENT_RECEIVED]: {
    queue: QUEUE_NAMES.TOKEN,
    job: JOB_NAMES.TOKEN,
  },
  // ✅ FIX: TOKEN_GENERATED now routes directly to DESIGN (skip card worker)
  [ORDER_EVENTS.TOKEN_GENERATED]: {
    queue: QUEUE_NAMES.PIPELINE,
    job: JOB_NAMES.DESIGN,
  },
  [ORDER_EVENTS.CARD_GENERATED]: {
    queue: QUEUE_NAMES.PIPELINE,
    job: JOB_NAMES.DESIGN,
  },
  [ORDER_EVENTS.DESIGN_COMPLETED]: {
    queue: QUEUE_NAMES.PIPELINE,
    job: JOB_NAMES.VENDOR,
  },
  [ORDER_EVENTS.VENDOR_ASSIGNED]: {
    queue: QUEUE_NAMES.PIPELINE,
    job: JOB_NAMES.PRINTING,
  },
  [ORDER_EVENTS.PRINTING_STARTED]: {
    queue: QUEUE_NAMES.PIPELINE,
    job: JOB_NAMES.SHIPMENT,
  },
  [ORDER_EVENTS.SHIPPED]: {
    queue: QUEUE_NAMES.NOTIFICATION,
    job: JOB_NAMES.NOTIFY,
  },
  [ORDER_EVENTS.DELIVERED]: {
    queue: QUEUE_NAMES.PIPELINE,
    job: JOB_NAMES.DELIVERY,
  },
  [ORDER_EVENTS.ORDER_COMPLETED]: {
    queue: QUEUE_NAMES.PIPELINE,
    job: JOB_NAMES.COMPLETION,
  },
  [ORDER_EVENTS.ORDER_CANCELLED]: {
    queue: QUEUE_NAMES.PIPELINE,
    job: JOB_NAMES.CANCEL,
  },
  [ORDER_EVENTS.STEP_FAILED]: {
    queue: QUEUE_NAMES.PIPELINE,
    job: JOB_NAMES.FAILURE,
  },
};

/**
 * Publish an order event to the appropriate queue.
 *
 * @param {string} event     - one of ORDER_EVENTS
 * @param {string} orderId
 * @param {object} payload   - additional data (no PII — only IDs and refs)
 * @param {object} options   - BullMQ job options override
 */
export async function publishEvent(event, orderId, payload = {}, options = {}) {
  const routing = EVENT_ROUTING[event];

  if (!routing) {
    throw new Error(`No routing defined for event: ${event}`);
  }

  const queue = getQueue(routing.queue);

  const jobData = {
    event,
    orderId,
    publishedAt: new Date().toISOString(),
    ...payload,
  };

  const jobOptions = {
    jobId: `${routing.job}:${orderId}:${Date.now()}`, // unique but traceable
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: { count: 100 },
    removeOnFail: false, // keep failed jobs for DLQ inspection
    ...options,
  };

  const job = await queue.add(routing.job, jobData, jobOptions);

  logger.info({
    msg: "Event published",
    event,
    orderId,
    queue: routing.queue,
    jobName: routing.job,
    jobId: job.id,
  });

  return job;
}

/**
 * Publish a STEP_FAILED event — routes to failure worker and DLQ pipeline.
 */
export async function publishFailure(orderId, step, error, meta = {}) {
  return publishEvent(ORDER_EVENTS.STEP_FAILED, orderId, {
    step,
    error: error?.message || String(error),
    stack: error?.stack,
    ...meta,
  });
}

/**
 * Publish a notification event (decoupled from pipeline queue).
 */
export async function publishNotification(
  type,
  orderId,
  recipientId,
  templateData = {},
) {
  const queue = getQueue(QUEUE_NAMES.NOTIFICATION);

  const jobData = {
    type,
    orderId,
    recipientId,
    templateData,
    publishedAt: new Date().toISOString(),
  };

  const job = await queue.add(JOB_NAMES.NOTIFY, jobData, {
    jobId: `notify:${type}:${orderId}:${Date.now()}`,
    attempts: 5,
    backoff: { type: "exponential", delay: 1000 },
    removeOnComplete: { count: 200 },
    removeOnFail: false,
  });

  logger.info({ msg: "Notification queued", type, orderId, jobId: job.id });

  return job;
}

// Add this function to event.publisher.js

/**
 * Publish event safely for manual triggers (fire and forget)
 */
export async function publishEventSafe(
  event,
  orderId,
  payload = {},
  options = {},
) {
  try {
    return await publishEvent(event, orderId, payload, options);
  } catch (err) {
    logger.error({
      msg: "Manual event publish failed — order will need manual retry",
      event,
      orderId,
      err: err.message,
    });
    return null;
  }
}
