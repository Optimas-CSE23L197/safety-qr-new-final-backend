// =============================================================================
// orchestrator/workers/maintenance.worker.js — RESQID PHASE 1
// Processes BACKGROUND_JOBS queue for maintenance jobs
// =============================================================================

import { Worker } from 'bullmq';
import { getQueueConnection } from '../queues/queue.connection.js';
import { QUEUE_NAMES } from '../queues/queue.names.js';
import { handleDeadJob } from '../dlq/dlq.handler.js';
import { logger } from '#config/logger.js';
import { prisma } from '#config/prisma.js';

const QUEUE = QUEUE_NAMES.BACKGROUND_JOBS;

export async function processMaintenanceJob(job) {
  const { action, payload } = job.data;

  logger.info({ jobId: job.id, action }, '[maintenance.worker] Processing maintenance job');

  switch (action) {
    case 'CLEANUP_EXPIRED_TOKENS':
      return cleanupExpiredTokens();

    case 'MONITOR_DLQ':
      return monitorDLQ();

    case 'DETECT_STALLED_PIPELINES':
      return detectStalledPipelines();

    case 'CLEAN_OLD_JOBS':
      return cleanOldJobs(payload?.olderThanDays || 7);

    default:
      logger.warn({ action }, '[maintenance.worker] Unknown maintenance action');
      return { skipped: true, reason: `Unknown action: ${action}` };
  }
}

async function cleanupExpiredTokens() {
  const expired = await prisma.token.updateMany({
    where: { expires_at: { lt: new Date() }, status: 'ACTIVE' },
    data: { status: 'EXPIRED' },
  });
  logger.info({ count: expired.count }, '[maintenance.worker] Expired tokens cleaned');
  return { expired: expired.count };
}

async function monitorDLQ() {
  const deadJobs = await prisma.deadLetterQueue.count({
    where: { resolved: false, created_at: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
  });
  logger.info({ deadJobs }, '[maintenance.worker] DLQ monitor');
  return { deadJobs, checked: true };
}

async function detectStalledPipelines() {
  const stalled = await prisma.orderPipeline.findMany({
    where: {
      current_step: { not: 'COMPLETED' },
      updated_at: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      is_stalled: false,
    },
  });

  if (stalled.length > 0) {
    await prisma.orderPipeline.updateMany({
      where: { id: { in: stalled.map(s => s.id) } },
      data: { is_stalled: true, stalled_at: new Date(), stalled_reason: 'No progress for 24h' },
    });
  }

  logger.info({ stalled: stalled.length }, '[maintenance.worker] Stalled pipelines detected');
  return { stalled: stalled.length };
}

async function cleanOldJobs(olderThanDays) {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);

  const deleted = await prisma.jobExecution.deleteMany({
    where: {
      status: { in: ['COMPLETED', 'DEAD'] },
      completed_at: { lt: cutoff },
    },
  });

  logger.info({ deleted: deleted.count, olderThanDays }, '[maintenance.worker] Old jobs cleaned');
  return { cleaned: deleted.count };
}

let _worker = null;

export const startMaintenanceWorker = () => {
  if (_worker) return _worker;

  _worker = new Worker(QUEUE, processMaintenanceJob, {
    connection: getQueueConnection(),
    concurrency: 2,
  });

  _worker.on('completed', (job, result) => {
    logger.info({ jobId: job.id, result }, '[maintenance.worker] Job completed');
  });

  _worker.on('failed', async (job, error) => {
    logger.error({ jobId: job?.id, err: error.message }, '[maintenance.worker] Job failed');
    if (job && job.attemptsMade >= (job.opts?.attempts ?? 3)) {
      await handleDeadJob({ job, error, queueName: QUEUE });
    }
  });

  _worker.on('error', err => {
    logger.error({ err: err.message }, '[maintenance.worker] Worker error');
  });

  logger.info({ queue: QUEUE, concurrency: 2 }, '[maintenance.worker] Started');
  return _worker;
};

export const stopMaintenanceWorker = async () => {
  if (_worker) {
    await _worker.close();
    _worker = null;
    logger.info('[maintenance.worker] Stopped');
  }
};
