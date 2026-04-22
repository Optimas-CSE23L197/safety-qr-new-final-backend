// =============================================================================
// orchestrator/events/event.publisher.js — RESQID
// publish(event) — validates shape, stamps id + createdAt, enqueues to
// the correct BullMQ queue based on event type.
// =============================================================================

import { randomUUID } from 'crypto';
import { EVENTS } from './event.types.js';
import {
  emergencyAlertsQueue,
  notificationsQueue,
  pipelineJobsQueue,
} from '../queues/queue.config.js';
import { logger } from '#config/logger.js';

// ── Event → Queue routing ─────────────────────────────────────────────────────

const EMERGENCY_EVENTS = new Set([
  EVENTS.EMERGENCY_ALERT_TRIGGERED,
  EVENTS.EMERGENCY_ALERT_ESCALATED,
]);

const BACKGROUND_EVENTS = new Set([
  EVENTS.ORDER_TOKEN_GENERATION_STARTED,
  EVENTS.ORDER_CARD_DESIGN_STARTED,
]);

const routeEvent = type => {
  if (EMERGENCY_EVENTS.has(type)) return emergencyAlertsQueue;
  if (BACKGROUND_EVENTS.has(type)) {
    if (!pipelineJobsQueue) {
      throw new Error(
        `Cannot publish ${type} — pipeline queue not enabled. Set ENABLE_PIPELINE_QUEUE=true`
      );
    }
    return pipelineJobsQueue;
  }
  return notificationsQueue;
};

// ── Per-queue BullMQ job options ──────────────────────────────────────────────

const getJobOptions = (type, id) => {
  const jobId = `${type}-${id}`;

  if (EMERGENCY_EVENTS.has(type)) {
    return {
      jobId,
      priority: 1,
      attempts: 5,
      backoff: { type: 'exponential', delay: 1000 },
    };
  }

  if (BACKGROUND_EVENTS.has(type)) {
    return {
      jobId,
      priority: 10,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    };
  }

  return {
    jobId,
    priority: 5,
    attempts: 3,
    backoff: { type: 'exponential', delay: 3000 },
  };
};

// ── Shape validation ──────────────────────────────────────────────────────────

const validateEvent = event => {
  if (!event || typeof event !== 'object') throw new TypeError('publish: event must be an object');
  if (!event.type) throw new TypeError('publish: event.type is required');
  if (!EVENTS[event.type]) throw new TypeError(`publish: unknown event type "${event.type}"`);
  if (!event.actorId) throw new TypeError('publish: event.actorId is required');
  if (!['USER', 'SYSTEM', 'WORKER'].includes(event.actorType)) {
    throw new TypeError('publish: actorType must be USER | SYSTEM | WORKER');
  }
};

// ── Publisher ─────────────────────────────────────────────────────────────────

export const publish = async event => {
  validateEvent(event);

  const stamped = {
    id: randomUUID(),
    type: event.type,
    schoolId: event.schoolId ?? null,
    actorId: event.actorId,
    actorType: event.actorType,
    payload: event.payload ?? {},
    createdAt: new Date().toISOString(),
    meta: {
      orderId: event.meta?.orderId ?? null,
      studentId: event.meta?.studentId ?? null,
      alertId: event.meta?.alertId ?? null,
      requestId: event.meta?.requestId ?? null,
    },
  };

  const queue = routeEvent(stamped.type);
  const jobOptions = getJobOptions(stamped.type, stamped.id);

  try {
    const job = await queue.add(stamped.type, stamped, jobOptions);
    logger.info(
      { eventId: stamped.id, type: stamped.type, queue: queue.name, jobId: job.id },
      '[event.publisher] Event published'
    );
    return job;
  } catch (err) {
    logger.error(
      { err: err.message, type: stamped.type, eventId: stamped.id },
      '[event.publisher] Failed to publish event'
    );
    throw err;
  }
};

// ── Convenience wrappers used by pipeline.worker.js + design.worker.js ───────

export const publishEvent = async (eventType, orderId, payload = {}) => {
  return publish({
    type: eventType,
    actorId: 'system',
    actorType: 'SYSTEM',
    payload,
    meta: { orderId },
  });
};

export const publishFailure = async (orderId, step, error, extraMeta = {}) => {
  return publish({
    type: 'WORKER_JOB_FAILED',
    actorId: 'system',
    actorType: 'SYSTEM',
    payload: {
      step,
      error: error?.message ?? String(error),
      stack: error?.stack ?? null,
      ...extraMeta,
    },
    meta: { orderId },
  });
};
