// =============================================================================
// orchestrator/workers/maintenance.worker.js — RESQID
//
// NO BullMQ. Runs maintenance tasks on plain setInterval (once every 24h).
// Can also be triggered manually via runMaintenanceNow() from admin API.
//
// Tasks:
//   - cleanupExpiredTokens   → mark expired tokens in DB
//   - detectStalledPipelines → flag orders stuck for 24h
//   - cleanOldJobExecutions  → delete old completed/dead JobExecution rows
// =============================================================================

import { prisma } from '#config/prisma.js';
import { logger } from '#config/logger.js';

const MAINTENANCE_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h

let _maintenanceInterval = null;

// =============================================================================
// TASKS
// =============================================================================

const cleanupExpiredTokens = async () => {
  const expired = await prisma.token.updateMany({
    where: { expires_at: { lt: new Date() }, status: 'ACTIVE' },
    data: { status: 'EXPIRED' },
  });
  logger.info({ count: expired.count }, '[maintenance] Expired tokens cleaned');
  return { expired: expired.count };
};

const detectStalledPipelines = async () => {
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

  logger.info({ stalled: stalled.length }, '[maintenance] Stalled pipelines detected');
  return { stalled: stalled.length };
};

const cleanOldJobExecutions = async (olderThanDays = 7) => {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
  const deleted = await prisma.jobExecution.deleteMany({
    where: { status: { in: ['COMPLETED', 'DEAD'] }, completed_at: { lt: cutoff } },
  });
  logger.info(
    { deleted: deleted.count, olderThanDays },
    '[maintenance] Old job executions cleaned'
  );
  return { cleaned: deleted.count };
};

// =============================================================================
// FULL MAINTENANCE RUN — exported so admin API can trigger manually
// =============================================================================

export const runMaintenanceNow = async () => {
  logger.info('[maintenance] Running full maintenance cycle');

  const results = await Promise.allSettled([
    cleanupExpiredTokens(),
    detectStalledPipelines(),
    cleanOldJobExecutions(),
  ]);

  const summary = {
    tokens:
      results[0].status === 'fulfilled' ? results[0].value : { error: results[0].reason?.message },
    pipelines:
      results[1].status === 'fulfilled' ? results[1].value : { error: results[1].reason?.message },
    jobs:
      results[2].status === 'fulfilled' ? results[2].value : { error: results[2].reason?.message },
    ranAt: new Date().toISOString(),
  };

  logger.info(summary, '[maintenance] Cycle complete');
  return summary;
};

// =============================================================================
// LIFECYCLE
// =============================================================================

export const startMaintenanceWorker = () => {
  // Run once immediately on startup (offset by 2 min to not spike with other workers)
  setTimeout(runMaintenanceNow, 2 * 60 * 1000);

  // Then every 24h
  _maintenanceInterval = setInterval(runMaintenanceNow, MAINTENANCE_INTERVAL_MS);
  if (_maintenanceInterval.unref) _maintenanceInterval.unref();

  logger.info('[maintenance] Started (24h interval, no BullMQ)');
};

export const stopMaintenanceWorker = async () => {
  if (_maintenanceInterval) {
    clearInterval(_maintenanceInterval);
    _maintenanceInterval = null;
  }
  logger.info('[maintenance] Stopped');
};
