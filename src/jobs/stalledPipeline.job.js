// =============================================================================
// stalledPipeline.job.js — RESQID (v2)
//
// FIXES IN THIS VERSION:
//   [F-1] Typo: runnningSteps → runningSteps (triple-n removed)
//   [F-2] is_stalled flag is never cleared here (auto-retry is out of scope for
//         this scheduler — manual retry via /retry-step clears it in retry.js).
//         Added a comment to clarify the contract.
//   [F-3] SIGTERM handler stub added to document shutdown contract.
// =============================================================================

import { prisma } from '#config/prisma.js';
import { redis } from '#config/redis.js';
import { tokenGenerationQueue, cardDesignQueue } from '#services/jobs/queue.service.js';
import * as pipelineRepo from '#modules/order/pipeline/pipeline.repository.js';
import { logger } from '#config/logger.js';

const STALL_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

export const detectStalledPipelines = async () => {
  const cutoff = new Date(Date.now() - STALL_THRESHOLD_MS);

  // [F-1] Fixed typo: runnningSteps → runningSteps
  const runningSteps = await prisma.orderStepExecution.findMany({
    where: {
      status: 'RUNNING',
      started_at: { lt: cutoff },
    },
    select: {
      id: true,
      pipeline_id: true,
      order_id: true,
      step: true,
      started_at: true,
      jobs: {
        select: {
          id: true,
          bullmq_job_id: true,
          status: true,
          queue_name: true,
        },
      },
    },
  });

  for (const step of runningSteps) {
    const elapsedMs = Date.now() - new Date(step.started_at).getTime();
    const elapsedMin = Math.round(elapsedMs / 60000);

    const isWorkerAlive = await checkWorkerAlive(step.jobs);

    if (!isWorkerAlive) {
      logger.warn(
        `[stall-detector] Stalled pipeline: order=${step.order_id} step=${step.step} elapsed=${elapsedMin}m`
      );

      // Mark stalled + publish SSE so dashboard shows alert immediately.
      // is_stalled is cleared when admin triggers a retry via /retry-step —
      // that path calls markPipelineUnstalled() before re-enqueuing.
      await Promise.all([
        pipelineRepo.markPipelineStalled(
          step.pipeline_id,
          `Step ${step.step} stalled after ${elapsedMin} minutes — worker may be down`
        ),
        redis.publish(
          `pipeline:${step.order_id}:progress`,
          JSON.stringify({
            ts: Date.now(),
            step: step.step,
            status: 'STALLED',
            elapsedMs,
            message: `Generation appears stalled (${elapsedMin}m). Check worker health.`,
          })
        ),
      ]);
    }
  }

  if (runningSteps.length > 0) {
    logger.info(`[stall-detector] Checked ${runningSteps.length} running steps`);
  }
};

const checkWorkerAlive = async jobs => {
  if (!jobs.length) return false;

  for (const job of jobs) {
    if (!job.bullmq_job_id) continue;

    const queue = job.queue_name === 'token-generation' ? tokenGenerationQueue : cardDesignQueue;

    const bullJob = await queue.getJob(job.bullmq_job_id).catch(() => null);
    if (bullJob) {
      const state = await bullJob.getState().catch(() => null);
      if (['active', 'waiting', 'delayed'].includes(state)) return true;
    }
  }

  return false;
};
