// =============================================================================
// orchestrator/jobs/scheduler.service.js — RESQID
// Registers all cron jobs on startup.
// UPDATED: Added Expo token cleanup job.
// =============================================================================

import cron from 'node-cron';
import { logger } from '#config/logger.js';
import { runBehavioralCleanup } from './behavioralCleanup.job.js';
import { detectStalledPipelines } from './stalledPipeline.job.js';
import { flushDlqSlackBatch } from '../dlq/dlq.handler.js';
import { cleanupExpoTokens } from './cleanupExpoTokens.job.js'; // ADDED

// ── Cron schedules ─────────────────────────────────────────────────────────────

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

  // Daily at 3 AM IST = 21:30 UTC previous day — Expo token cleanup
  EXPO_TOKEN_CLEANUP: {
    cron: '30 21 * * *',
    timezone: 'Asia/Kolkata',
    display: '3:00 AM IST daily',
  },
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

    // ADDED: Expo token cleanup
    cron.schedule(
      SCHEDULES.EXPO_TOKEN_CLEANUP.cron,
      safeRun('expo_token_cleanup', cleanupExpoTokens),
      { timezone: SCHEDULES.EXPO_TOKEN_CLEANUP.timezone }
    ),
  ];

  logger.info(
    {
      jobs: [
        { name: 'behavioral_cleanup', schedule: SCHEDULES.BEHAVIORAL_CLEANUP.display },
        { name: 'stalled_pipeline', schedule: SCHEDULES.STALLED_PIPELINE.display },
        { name: 'dlq_slack_flush', schedule: SCHEDULES.DLQ_SLACK_FLUSH.display },
        { name: 'expo_token_cleanup', schedule: SCHEDULES.EXPO_TOKEN_CLEANUP.display }, // ADDED
      ],
    },
    '[scheduler] All crons registered'
  );

  setTimeout(safeRun('stalled_pipeline_startup', detectStalledPipelines), 10_000);
};

export const stopScheduler = () => {
  for (const job of _jobs) job.stop();
  _jobs = [];
  logger.info('[scheduler] All crons stopped');
};

export const triggerJob = async name => {
  switch (name) {
    case 'behavioral_cleanup':
      return runBehavioralCleanup();
    case 'stalled_pipeline':
      return detectStalledPipelines();
    case 'dlq_slack_flush':
      return flushDlqSlackBatch();
    case 'expo_token_cleanup': // ADDED
      return cleanupExpoTokens();
    default:
      throw new Error(`[scheduler] Unknown job name: "${name}"`);
  }
};

export const jobScheduler = {
  start: startScheduler,
  stop: stopScheduler,
  trigger: triggerJob,
};
