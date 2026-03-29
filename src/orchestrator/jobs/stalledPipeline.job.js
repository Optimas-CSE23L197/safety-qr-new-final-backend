// =============================================================================
// orchestrator/jobs/stalledPipeline.job.js — RESQID PHASE 1
// Stall detection — runs every 15 minutes.
// =============================================================================

import { prisma } from '#config/prisma.js';
import { logger } from '#config/logger.js';

const STALL_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours

export const detectStalledPipelines = async () => {
  const startTime = Date.now();
  const cutoff = new Date(Date.now() - STALL_THRESHOLD_MS);

  logger.info({ cutoff }, '[stalled.pipeline] Job started');

  const stalledCandidates = await prisma.orderPipeline.findMany({
    where: {
      is_stalled: false,
      completed_at: null,
      updated_at: { lt: cutoff },
    },
    include: {
      order: {
        select: {
          id: true,
          order_number: true,
          school_id: true,
          school: { select: { name: true } },
        },
      },
    },
    take: 100,
  });

  let newlyStalled = 0;

  for (const pipeline of stalledCandidates) {
    const elapsedMs = Date.now() - new Date(pipeline.updated_at).getTime();
    const elapsedMin = Math.round(elapsedMs / 60000);

    logger.warn(
      {
        pipelineId: pipeline.id,
        orderId: pipeline.order_id,
        step: pipeline.current_step,
        elapsedMin,
      },
      '[stalled.pipeline] Stall detected'
    );

    await prisma.orderPipeline.update({
      where: { id: pipeline.id },
      data: {
        is_stalled: true,
        stalled_at: new Date(),
        stalled_reason: `Step "${pipeline.current_step}" stalled after ${elapsedMin} minutes`,
      },
    });
    newlyStalled++;
  }

  const durationMs = Date.now() - startTime;
  logger.info(
    { checked: stalledCandidates.length, newlyStalled, durationMs },
    '[stalled.pipeline] Completed'
  );

  return { checked: stalledCandidates.length, newlyStalled };
};
