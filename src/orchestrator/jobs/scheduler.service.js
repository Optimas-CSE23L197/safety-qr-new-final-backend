// =============================================================================
// orchestrator/jobs/scheduler.js — RESQID
// Registers all cron jobs on startup.
// Exactly 3 registered crons — per spec.
// Adding a new cron = add job file + add schedule + add entry here.
//
// FIXED vs old scheduler_service.js:
//   [F-1] Only 3 spec-defined crons — extra jobs removed
//   [F-2] Behavioral cleanup at 2 AM IST (not every hour, not every 5 min)
//   [F-3] Stall check every 15 min (not every 5 min)
//   [F-4] invoice.job is event-triggered — no cron entry for it
//   [F-5] All inline email HTML removed — templates.js is authoritative
//   [F-6] DLQ Slack batch flushed hourly by this scheduler (not a separate cron job)
// =============================================================================

import cron from 'node-cron';
import { logger } from '#config/logger.js';
import { runBehavioralCleanup } from './behavioralCleanup.job.js';
import { detectStalledPipelines } from './stalledPipeline.job.js';
import { flushDlqSlackBatch } from '../dlq/dlq.handler.js';

// ── Cron schedules ─────────────────────────────────────────────────────────────
// All times in IST (Asia/Kolkata, UTC+5:30).
// node-cron does NOT support named timezones natively in all versions —
// we use the explicit UTC equivalent with the timezone option as the safe approach.

const SCHEDULES = Object.freeze({
  // 2 AM IST = 20:30 UTC previous day
  BEHAVIORAL_CLEANUP: {
    cron: '30 20 * * *',
    timezone: 'Asia/Kolkata',
    display: '2:00 AM IST daily',
  },

  // Every 15 minutes
  STALLED_PIPELINE: { cron: '*/15 * * * *', timezone: 'Asia/Kolkata', display: 'Every 15 minutes' },

  // Every hour — flush non-emergency DLQ Slack batch
  DLQ_SLACK_FLUSH: { cron: '0 * * * *', timezone: 'Asia/Kolkata', display: 'Every hour' },
});

// ── Job wrappers with error isolation ─────────────────────────────────────────

const safeRun = (name, fn) => async () => {
  try {
    await fn();
  } catch (err) {
    logger.error({ err: err.message, job: name }, `[scheduler] ${name} threw uncaught error`);
  }
};

// ── Scheduler manager ─────────────────────────────────────────────────────────

let _jobs = [];

export const startScheduler = () => {
  if (_jobs.length > 0) {
    logger.warn('[scheduler] Already started — skipping');
    return;
  }

  logger.info('[scheduler] Starting cron scheduler');

  _jobs = [
    cron.schedule(
      SCHEDULES.BEHAVIORAL_CLEANUP.cron,
      safeRun('behavioral_cleanup', runBehavioralCleanup),
      { timezone: SCHEDULES.BEHAVIORAL_CLEANUP.timezone }
    ),

    cron.schedule(
      SCHEDULES.STALLED_PIPELINE.cron,
      safeRun('stalled_pipeline', detectStalledPipelines),
      { timezone: SCHEDULES.STALLED_PIPELINE.timezone }
    ),

    cron.schedule(SCHEDULES.DLQ_SLACK_FLUSH.cron, safeRun('dlq_slack_flush', flushDlqSlackBatch), {
      timezone: SCHEDULES.DLQ_SLACK_FLUSH.timezone,
    }),
  ];

  logger.info(
    {
      jobs: [
        { name: 'behavioral_cleanup', schedule: SCHEDULES.BEHAVIORAL_CLEANUP.display },
        { name: 'stalled_pipeline', schedule: SCHEDULES.STALLED_PIPELINE.display },
        { name: 'dlq_slack_flush', schedule: SCHEDULES.DLQ_SLACK_FLUSH.display },
      ],
    },
    '[scheduler] All crons registered'
  );

  // Warm-up: run stall check once after 10 seconds so we catch anything
  // that stalled while the process was down
  setTimeout(safeRun('stalled_pipeline_startup', detectStalledPipelines), 10_000);
};

export const stopScheduler = () => {
  for (const job of _jobs) job.stop();
  _jobs = [];
  logger.info('[scheduler] All crons stopped');
};

/**
 * Manually trigger a named job — used by super admin API and tests.
 * @param {'behavioral_cleanup' | 'stalled_pipeline' | 'dlq_slack_flush'} name
 */
export const triggerJob = async name => {
  switch (name) {
    case 'behavioral_cleanup':
      return runBehavioralCleanup();
    case 'stalled_pipeline':
      return detectStalledPipelines();
    case 'dlq_slack_flush':
      return flushDlqSlackBatch();
    default:
      throw new Error(`[scheduler] Unknown job name: "${name}"`);
  }
};

export const jobScheduler = {
  start: startScheduler,
  stop: stopScheduler,
  trigger: triggerJob,
};
