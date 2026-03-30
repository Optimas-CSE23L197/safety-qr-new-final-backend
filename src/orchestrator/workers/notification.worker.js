// =============================================================================
// orchestrator/workers/notification.worker.js — RESQID PHASE 1
// Processes NOTIFICATIONS queue. ALWAYS ON.
//
// FIX [N-1]: schoolId pulled from job.data.schoolId (top-level on stamped
//            event) not payload.schoolId. The stamped event shape from
//            event.publisher.js is:
//            { id, type, schoolId, actorId, actorType, payload, meta, createdAt }
//            schoolId is never inside payload — pulling it from there always
//            returned null, silently breaking all school DB lookups in the
//            dispatcher (email, SMS to school phone, push to school admins).
// =============================================================================

import { Worker } from 'bullmq';
import { getQueueConnection } from '../queues/queue.connection.js';
import { QUEUE_NAMES } from '../queues/queue.names.js';
import { dispatch } from '../notifications/notification.dispatcher.js';
import { handleDeadJob } from '../dlq/dlq.handler.js';
import { logger } from '#config/logger.js';

const QUEUE = QUEUE_NAMES.NOTIFICATIONS;

export const processNotificationJob = async job => {
  const { type, payload, meta, schoolId } = job.data ?? {};

  logger.info({ jobId: job.id, type, queue: QUEUE }, '[notification.worker] Processing job');

  if (!type) {
    throw new Error('[notification.worker] job.data.type is required');
  }

  await dispatch({
    type,
    payload: payload ?? {},
    meta: meta ?? {},
    schoolId: schoolId ?? null, // FIX [N-1]: top-level field, not payload.schoolId
  });
};

let _worker = null;

export const startNotificationWorker = () => {
  if (_worker) return _worker;

  _worker = new Worker(QUEUE, processNotificationJob, {
    connection: getQueueConnection(),
    concurrency: 5,
  });

  _worker.on('completed', job => {
    logger.info({ jobId: job.id, queue: QUEUE }, '[notification.worker] Job completed');
  });

  _worker.on('failed', async (job, error) => {
    logger.error({ jobId: job?.id, err: error.message }, '[notification.worker] Job failed');
    if (job && job.attemptsMade >= (job.opts?.attempts ?? 3)) {
      await handleDeadJob({ job, error, queueName: QUEUE });
    }
  });

  _worker.on('error', err => {
    logger.error({ err: err.message }, '[notification.worker] Worker error');
  });

  logger.info({ queue: QUEUE, concurrency: 5 }, '[notification.worker] Started');
  return _worker;
};

export const stopNotificationWorker = async () => {
  if (_worker) {
    await _worker.close();
    _worker = null;
    logger.info('[notification.worker] Stopped');
  }
};
