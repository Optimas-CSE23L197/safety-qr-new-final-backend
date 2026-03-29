// =============================================================================
// orchestrator/workers/notification.worker.js — RESQID PHASE 1
// Processes NOTIFICATIONS queue. ALWAYS ON.
// =============================================================================

import { Worker } from 'bullmq';
import { getQueueConnection } from '../queues/queue.connection.js';
import { QUEUE_NAMES } from '../queues/queue.names.js';
import { dispatch } from '../notifications/notification.dispatcher.js';
import { handleDeadJob } from '../dlq/dlq.handler.js';
import { logger } from '#config/logger.js';

const QUEUE = QUEUE_NAMES.NOTIFICATIONS; // FIXED: Use correct Phase 1 queue

export const processNotificationJob = async job => {
  const { type, payload, meta } = job.data ?? {};

  logger.info({ jobId: job.id, type, queue: QUEUE }, '[notification.worker] Processing job');

  if (!type) {
    throw new Error('[notification.worker] job.data.type is required');
  }

  await dispatch({
    type,
    payload: payload ?? {},
    meta: meta ?? {},
    schoolId: payload?.schoolId ?? null,
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
