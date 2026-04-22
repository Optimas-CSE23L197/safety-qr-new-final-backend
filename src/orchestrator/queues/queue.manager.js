// =============================================================================
// orchestrator/queues/queue.manager.js — RESQID
//
// Manages the 2 Railway queues (emergency + notification).
// pipelineJobsQueue is local-only — only available when ENABLE_PIPELINE_QUEUE=true
// =============================================================================

import { prisma } from '#config/prisma.js';
import { logger } from '#config/logger.js';
import {
  allQueues,
  getQueueByName,
  closeAllQueues,
  getAllQueueMetrics,
  emergencyAlertsQueue,
  notificationsQueue,
  pipelineJobsQueue,
} from './queue.config.js';

export {
  allQueues,
  getQueueByName,
  closeAllQueues,
  getAllQueueMetrics,
  emergencyAlertsQueue,
  notificationsQueue,
  pipelineJobsQueue,
};

export function getQueue(name) {
  return getQueueByName(name);
}

export function initQueues() {
  const queueCount = Object.keys(allQueues).length;
  logger.info({
    msg: 'Orchestrator queues initialized',
    count: queueCount,
    queues: Object.keys(allQueues),
  });

  for (const [name, queue] of Object.entries(allQueues)) {
    setupQueueEventHandlers(queue, name);
  }
}

function setupQueueEventHandlers(queue, queueName) {
  queue.on('error', err => {
    logger.error({ queue: queueName, err: err.message }, '[queue.manager] Queue error');
  });

  queue.on('failed', async (job, err) => {
    if (!job) return;

    const attemptsMade = job.attemptsMade;
    const maxAttempts = job.opts?.attempts ?? 3;
    const isFinalFailure = attemptsMade >= maxAttempts;

    logger.error(
      {
        queue: queueName,
        jobId: job.id,
        jobName: job.name,
        attemptsMade,
        maxAttempts,
        isFinalFailure,
        error: err.message,
      },
      '[queue.manager] Job failed'
    );

    if (job.data?.jobExecutionId) {
      try {
        await prisma.jobExecution.update({
          where: { id: job.data.jobExecutionId },
          data: {
            status: isFinalFailure ? 'DEAD' : 'FAILED',
            error_message: err.message,
            completed_at: isFinalFailure ? new Date() : null,
          },
        });
      } catch (dbError) {
        logger.error(
          { jobExecutionId: job.data.jobExecutionId, error: dbError.message },
          '[queue.manager] Failed to update job execution record'
        );
      }
    }
  });

  queue.on('completed', async job => {
    logger.info(
      {
        queue: queueName,
        jobId: job.id,
        jobName: job.name,
        duration: job.finishedOn - job.processedOn,
      },
      '[queue.manager] Job completed'
    );

    if (job.data?.jobExecutionId) {
      try {
        await prisma.jobExecution.update({
          where: { id: job.data.jobExecutionId },
          data: { status: 'COMPLETED', completed_at: new Date(), result: job.returnvalue },
        });
      } catch (dbError) {
        logger.error(
          { jobExecutionId: job.data.jobExecutionId, error: dbError.message },
          '[queue.manager] Failed to update job completion record'
        );
      }
    }
  });

  queue.on('stalled', jobId => {
    logger.warn(
      { queue: queueName, jobId },
      '[queue.manager] Job stalled — BullMQ will re-queue automatically'
    );
  });

  queue.on('paused', () => logger.warn({ queue: queueName }, '[queue.manager] Queue paused'));
  queue.on('resumed', () => logger.info({ queue: queueName }, '[queue.manager] Queue resumed'));
  queue.on('drained', () => logger.debug({ queue: queueName }, '[queue.manager] Queue drained'));
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
  const cutoffTimestamp = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
  const results = {};

  for (const [name, queue] of Object.entries(allQueues)) {
    const removed = { completed: 0, failed: 0, delayed: 0 };

    const completedJobs = await queue.getJobs(['completed']);
    for (const job of completedJobs.filter(j => j.finishedOn < cutoffTimestamp)) {
      await job.remove();
      removed.completed++;
    }

    const failedJobs = await queue.getJobs(['failed']);
    for (const job of failedJobs.filter(j => j.finishedOn < cutoffTimestamp)) {
      await job.remove();
      removed.failed++;
    }

    const delayedJobs = await queue.getJobs(['delayed']);
    for (const job of delayedJobs.filter(j => j.timestamp < cutoffTimestamp)) {
      await job.remove();
      removed.delayed++;
    }

    results[name] = removed;
  }

  logger.info({ olderThanDays, results }, '[queue.manager] Cleaned old jobs');
  return results;
}
