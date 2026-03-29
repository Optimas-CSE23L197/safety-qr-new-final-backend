// =============================================================================
// orchestrator/queues/queue.manager.js — RESQID PHASE 1 (Production)
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
  backgroundJobsQueue,
} from './queue.config.js';

// Re-export
export {
  allQueues,
  getQueueByName,
  closeAllQueues,
  getAllQueueMetrics,
  emergencyAlertsQueue,
  notificationsQueue,
  backgroundJobsQueue,
};

export function getQueue(name) {
  return getQueueByName(name);
}

export function initQueues() {
  const queueCount = Object.keys(allQueues).length;
  logger.info({
    msg: 'Phase 1 orchestrator queues initialized',
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
    const maxAttempts = job.opts.attempts;
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

    // Move to Dead Letter Queue on final failure
    if (isFinalFailure) {
      try {
        const { handleDeadJob } = await import('../dlq/dlq.handler.js');
        if (handleDeadJob) {
          await handleDeadJob({ job, error: err, queueName });
        } else {
          logger.error('[queue.manager] DLQ handler not available');
        }
      } catch (dlqError) {
        logger.error(
          { queue: queueName, jobId: job.id, error: dlqError.message },
          '[queue.manager] CRITICAL: Failed to move job to DLQ'
        );
      }
    }

    // Update database execution record
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
          '[queue.manager] Failed to update job execution'
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
          '[queue.manager] Failed to update job completion'
        );
      }
    }
  });

  queue.on('stalled', jobId => {
    logger.warn({ queue: queueName, jobId }, '[queue.manager] Job stalled');
    // ✅ Auto-clean stalled jobs after logging
    queue
      .getJob(jobId)
      .then(job => {
        if (job) {
          job.remove().then(() => {
            logger.info({ queue: queueName, jobId }, '[queue.manager] Stalled job removed');
          });
        }
      })
      .catch(err => {
        logger.error(
          { queue: queueName, jobId, error: err.message },
          '[queue.manager] Failed to remove stalled job'
        );
      });
  });

  queue.on('paused', () => logger.warn({ queue: queueName }, '[queue.manager] Queue paused'));
  queue.on('resumed', () => logger.info({ queue: queueName }, '[queue.manager] Queue resumed'));
  queue.on('drained', () => logger.debug({ queue: queueName }, '[queue.manager] Queue drained'));
}

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
    logger.warn({ bullJobId, jobExecutionId }, '[queue.manager] Job not found');
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
  return await getAllQueueMetrics();
}

export async function retryJob(jobId, queueName) {
  const queue = getQueue(queueName);
  const job = await queue.getJob(jobId);
  if (!job) throw new Error(`Job ${jobId} not found`);
  await job.retry();
  logger.info({ jobId, queueName }, '[queue.manager] Job retried');
  return job;
}

export async function cleanOldJobs(olderThanDays = 7) {
  const cutoffTimestamp = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
  const results = {};

  for (const [name, queue] of Object.entries(allQueues)) {
    const removed = { completed: 0, failed: 0, stalled: 0, delayed: 0 };

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

    // ✅ Clean stalled jobs
    const stalledJobs = await queue.getJobs(['stalled']);
    for (const job of stalledJobs.filter(j => j.processedOn < cutoffTimestamp)) {
      await job.remove();
      removed.stalled++;
    }

    // ✅ Clean delayed jobs
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
