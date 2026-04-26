// =============================================================================
// orchestrator/queues/queue.manager.js — RESQID
//
// Manages the 2 Railway queues (emergency + notification).
// pipelineJobsQueue is local-only — only available when ENABLE_PIPELINE_QUEUE=true
//
// FIXED:
//   - queue.on('failed') / queue.on('completed') / queue.on('stalled') never
//     fired on Queue instances (Worker-only events). Replaced with QueueEvents
//     which is BullMQ's dedicated cross-process event listener.
//   - QueueEvents refs stored in _queueEvents[] so they close cleanly on shutdown.
//   - cleanOldJobs() now uses queue.clean() (server-side) instead of fetching
//     all jobs into memory.
// =============================================================================

import { QueueEvents } from 'bullmq';
import { prisma } from '#config/prisma.js';
import { logger } from '#config/logger.js';
import { getQueueConnection } from './queue.connection.js';
import {
  allQueues,
  getQueueByName,
  closeAllQueues as _closeAllQueues,
  getAllQueueMetrics,
  emergencyAlertsQueue,
  notificationsQueue,
  pipelineJobsQueue,
} from './queue.config.js';

export {
  allQueues,
  getQueueByName,
  getAllQueueMetrics,
  emergencyAlertsQueue,
  notificationsQueue,
  pipelineJobsQueue,
};

// ── QueueEvents registry (for graceful shutdown) ──────────────────────────────
const _queueEvents = [];

// ── Public API ────────────────────────────────────────────────────────────────

export function getQueue(name) {
  return getQueueByName(name);
}

export function initQueues() {
  const queueCount = Object.keys(allQueues).length;
  logger.info(
    { count: queueCount, queues: Object.keys(allQueues) },
    '[queue.manager] Orchestrator queues initialized'
  );

  for (const [name, queue] of Object.entries(allQueues)) {
    const qe = setupQueueEventHandlers(queue, name);
    _queueEvents.push(qe);
  }
}

// Closes both Queue instances and QueueEvents listeners
export async function closeAllQueues() {
  for (const qe of _queueEvents) {
    await qe.close();
  }
  await _closeAllQueues();
}

// ── Event handlers ────────────────────────────────────────────────────────────

function setupQueueEventHandlers(queue, queueName) {
  // ── Queue-level events (these actually fire on Queue instances) ─────────────
  queue.on('error', err => {
    logger.error({ queue: queueName, err: err.message }, '[queue.manager] Queue error');
  });
  queue.on('paused', () => logger.warn({ queue: queueName }, '[queue.manager] Queue paused'));
  queue.on('resumed', () => logger.info({ queue: queueName }, '[queue.manager] Queue resumed'));
  queue.on('drained', () => logger.debug({ queue: queueName }, '[queue.manager] Queue drained'));

  // ── Job lifecycle events via QueueEvents (cross-process safe) ───────────────
  // queue.on('failed') / queue.on('completed') / queue.on('stalled') are
  // Worker-only events — they never fire on a Queue instance. QueueEvents
  // subscribes via Redis Pub/Sub and works from any process.
  const qe = new QueueEvents(queueName, { connection: getQueueConnection() });

  qe.on('failed', async ({ jobId, failedReason }) => {
    logger.error({ queue: queueName, jobId, failedReason }, '[queue.manager] Job failed');

    const job = await queue.getJob(jobId);
    if (!job?.data?.jobExecutionId) return;

    const isFinalFailure = job.attemptsMade >= (job.opts?.attempts ?? 3);

    try {
      await prisma.jobExecution.update({
        where: { id: job.data.jobExecutionId },
        data: {
          status: isFinalFailure ? 'DEAD' : 'FAILED',
          error_message: failedReason,
          completed_at: isFinalFailure ? new Date() : null,
        },
      });
    } catch (dbErr) {
      logger.error(
        { jobExecutionId: job.data.jobExecutionId, err: dbErr.message },
        '[queue.manager] Failed to update job execution record'
      );
    }
  });

  qe.on('completed', async ({ jobId, returnvalue }) => {
    logger.info({ queue: queueName, jobId }, '[queue.manager] Job completed');

    const job = await queue.getJob(jobId);
    if (!job?.data?.jobExecutionId) return;

    try {
      await prisma.jobExecution.update({
        where: { id: job.data.jobExecutionId },
        data: {
          status: 'COMPLETED',
          completed_at: new Date(),
          result: returnvalue ?? null,
        },
      });
    } catch (dbErr) {
      logger.error(
        { jobExecutionId: job.data.jobExecutionId, err: dbErr.message },
        '[queue.manager] Failed to update job completion record'
      );
    }
  });

  qe.on('stalled', ({ jobId }) => {
    logger.warn(
      { queue: queueName, jobId },
      '[queue.manager] Job stalled — BullMQ will re-queue automatically'
    );
  });

  return qe;
}

// =============================================================================
// ADMIN UTILITIES
// =============================================================================

export async function drainDeadJob(jobExecutionId, bullJobId, queueName = null) {
  let job = null;
  let foundQueue = null;

  if (queueName && allQueues[queueName]) {
    job = await allQueues[queueName].getJob(bullJobId);
    foundQueue = queueName;
  } else {
    for (const [name, queue] of Object.entries(allQueues)) {
      job = await queue.getJob(bullJobId);
      if (job) {
        foundQueue = name;
        break;
      }
    }
  }

  if (!job) {
    logger.warn({ bullJobId, jobExecutionId }, '[queue.manager] Job not found for drain');
    return false;
  }

  await job.remove();
  await prisma.jobExecution.update({
    where: { id: jobExecutionId },
    data: { status: 'DEAD', completed_at: new Date() },
  });

  logger.info({ jobExecutionId, bullJobId, queue: foundQueue }, '[queue.manager] Dead job drained');
  return true;
}

export async function getQueueHealth() {
  return getAllQueueMetrics();
}

export async function retryJob(jobId, queueName) {
  const queue = getQueue(queueName);
  const job = await queue.getJob(jobId);
  if (!job) throw new Error(`[queue.manager] Job ${jobId} not found in ${queueName}`);
  await job.retry();
  logger.info({ jobId, queueName }, '[queue.manager] Job retried');
  return job;
}

export async function cleanOldJobs(olderThanDays = 7) {
  const graceMs = olderThanDays * 24 * 60 * 60 * 1000;
  const results = {};

  for (const [name, queue] of Object.entries(allQueues)) {
    // queue.clean() is server-side — no full fetch into memory
    const [completed, failed, delayed] = await Promise.all([
      queue.clean(graceMs, 1000, 'completed'),
      queue.clean(graceMs, 1000, 'failed'),
      queue.clean(graceMs, 1000, 'delayed'),
    ]);
    results[name] = {
      completed: completed.length,
      failed: failed.length,
      delayed: delayed.length,
    };
  }

  logger.info({ olderThanDays, results }, '[queue.manager] Cleaned old jobs');
  return results;
}
