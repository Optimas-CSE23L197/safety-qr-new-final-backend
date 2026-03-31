// =============================================================================
// orchestrator/workers/scan.worker.js — RESQID
//
// Background worker for scan-related async tasks.
//
// RESPONSIBILITIES:
//   1. Drain Redis scan log queue → bulk insert to DB (every 5 seconds)
//   2. Sync DB IP blocklist → Redis on startup (warm the Redis blocklist)
//   3. Expire stale IpBlocklist rows from DB (every 6 hours)
//
// WHY A SEPARATE SCAN WORKER:
//   The hot path (resolveScan) never touches Postgres for log writes.
//   Instead, log entries are pushed to a Redis list.
//   This worker drains that list in batches, keeping Postgres write load
//   flat regardless of scan volume.
//
//   Under a DDoS at 1000 scans/min:
//     Without worker: 1000 Postgres inserts/min on the hot path
//     With worker:    1 bulk insert of 1000 rows every 60 seconds
//
// QUEUE:
//   Uses BullMQ 'background' queue for the IP sync + expire jobs.
//   The log drain runs on a plain setInterval — not a BullMQ job —
//   because it runs every 5 seconds and BullMQ overhead would be wasteful.
//
// CONCURRENCY:
//   concurrency: 1 — log drain is serial, no race condition on ltrim.
// =============================================================================

import { Worker, Queue } from 'bullmq';
import { getQueueConnection } from '../queues/queue.connection.js';
import { QUEUE_NAMES } from '../queues/queue.names.js';
import { prisma } from '#config/prisma.js';
import { redis } from '#config/redis.js';
import { logger } from '#config/logger.js';
import { drainScanLogQueue } from '#shared/cache/scan.cache.js';
import { bulkWriteScanLogs } from '../../modules/scan/scan.repository.js';

const DRAIN_INTERVAL_MS = 5_000; // drain log queue every 5 seconds
const DRAIN_BATCH_SIZE = 500; // max entries per drain cycle

let _drainInterval = null;
let _worker = null;

// =============================================================================
// LOG DRAIN — plain setInterval (not BullMQ, runs every 5s)
// =============================================================================

const runLogDrain = async () => {
  try {
    const entries = await drainScanLogQueue(DRAIN_BATCH_SIZE);
    if (!entries.length) return;

    await bulkWriteScanLogs(entries);

    logger.debug({ count: entries.length }, '[scan.worker] Scan log batch inserted');
  } catch (err) {
    logger.error({ err: err.message }, '[scan.worker] Log drain cycle failed');
    // Do not rethrow — next cycle will pick up remaining entries
  }
};

// =============================================================================
// BULLMQ JOBS — IP sync and blocklist expiry
// =============================================================================

const JOB_NAMES = {
  SYNC_IP_BLOCKLIST: 'scan:sync_ip_blocklist',
  EXPIRE_IP_BLOCKLIST: 'scan:expire_ip_blocklist',
};

/**
 * Sync active DB IP blocklist entries to Redis.
 * Runs on startup and every 15 minutes via repeatable job.
 * Ensures Redis is authoritative even after a Redis restart.
 */
const syncIpBlocklistToRedis = async () => {
  try {
    const activeBlocks = await prisma.ipBlocklist.findMany({
      where: {
        is_active: true,
        OR: [{ expires_at: null }, { expires_at: { gt: new Date() } }],
      },
      select: { ip_address: true, reason: true, expires_at: true },
    });

    if (!activeBlocks.length) return;

    const pipeline = redis.pipeline();
    for (const block of activeBlocks) {
      const key = `blocked:ip:${block.ip_address}`;
      if (block.expires_at) {
        const ttl = Math.floor((block.expires_at.getTime() - Date.now()) / 1000);
        if (ttl > 0) pipeline.set(key, block.reason, 'EX', ttl);
      } else {
        // No expiry — set 30 day TTL as a safety cap
        pipeline.set(key, block.reason, 'EX', 60 * 60 * 24 * 30);
      }
    }
    await pipeline.exec();

    logger.info({ count: activeBlocks.length }, '[scan.worker] IP blocklist synced to Redis');
  } catch (err) {
    logger.error({ err: err.message }, '[scan.worker] syncIpBlocklistToRedis failed');
  }
};

/**
 * Deactivate expired IpBlocklist rows in DB.
 * Keeps the DB table clean. Runs every 6 hours.
 */
const expireIpBlocklistRows = async () => {
  try {
    const result = await prisma.ipBlocklist.updateMany({
      where: {
        is_active: true,
        expires_at: { lt: new Date() },
      },
      data: { is_active: false },
    });
    if (result.count > 0) {
      logger.info({ count: result.count }, '[scan.worker] Expired IP blocklist rows deactivated');
    }
  } catch (err) {
    logger.error({ err: err.message }, '[scan.worker] expireIpBlocklistRows failed');
  }
};

// ── BullMQ job processor ──────────────────────────────────────────────────────

const processScanJob = async job => {
  switch (job.name) {
    case JOB_NAMES.SYNC_IP_BLOCKLIST:
      await syncIpBlocklistToRedis();
      break;

    case JOB_NAMES.EXPIRE_IP_BLOCKLIST:
      await expireIpBlocklistRows();
      break;

    default:
      logger.warn({ jobName: job.name }, '[scan.worker] Unknown job name — skipping');
  }
};

// =============================================================================
// WORKER LIFECYCLE
// =============================================================================

export const startScanWorker = async () => {
  if (_worker) return _worker;

  // 1. Warm Redis blocklist on startup — before accepting any traffic
  logger.info('[scan.worker] Warming IP blocklist cache...');
  await syncIpBlocklistToRedis();

  // 2. Start log drain interval
  _drainInterval = setInterval(runLogDrain, DRAIN_INTERVAL_MS);
  // Ensure interval doesn't prevent process exit
  if (_drainInterval.unref) _drainInterval.unref();

  // 3. Start BullMQ worker for scheduled jobs
  _worker = new Worker(QUEUE_NAMES.BACKGROUND, processScanJob, {
    connection: getQueueConnection(),
    concurrency: 1,
  });

  _worker.on('completed', job => {
    logger.debug({ jobName: job.name }, '[scan.worker] Job completed');
  });

  _worker.on('failed', (job, err) => {
    logger.error({ jobName: job?.name, err: err.message }, '[scan.worker] Job failed');
  });

  _worker.on('error', err => {
    logger.error({ err: err.message }, '[scan.worker] Worker error');
  });

  // 4. Schedule repeatable jobs if not already scheduled
  const queue = new Queue(QUEUE_NAMES.BACKGROUND, { connection: getQueueConnection() });

  await queue.add(
    JOB_NAMES.SYNC_IP_BLOCKLIST,
    {},
    {
      repeat: { every: 15 * 60 * 1000 }, // every 15 minutes
      jobId: JOB_NAMES.SYNC_IP_BLOCKLIST,
    }
  );

  await queue.add(
    JOB_NAMES.EXPIRE_IP_BLOCKLIST,
    {},
    {
      repeat: { every: 6 * 60 * 60 * 1000 }, // every 6 hours
      jobId: JOB_NAMES.EXPIRE_IP_BLOCKLIST,
    }
  );

  await queue.close();

  logger.info(
    { queue: QUEUE_NAMES.BACKGROUND, drainIntervalMs: DRAIN_INTERVAL_MS },
    '[scan.worker] Started'
  );

  return _worker;
};

export const stopScanWorker = async () => {
  if (_drainInterval) {
    clearInterval(_drainInterval);
    _drainInterval = null;
  }
  // Final drain before shutdown — don't lose buffered logs
  await runLogDrain();

  if (_worker) {
    await _worker.close();
    _worker = null;
    logger.info('[scan.worker] Stopped');
  }
};
