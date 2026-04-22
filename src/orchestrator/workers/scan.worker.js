// =============================================================================
// orchestrator/workers/scan.worker.js — RESQID
//
// NO BullMQ worker here. Plain async functions + setInterval only.
//
// RESPONSIBILITIES:
//   1. On startup → sync DB IP blocklist → Redis
//   2. Every 60s  → drain Redis scan log queue → bulk insert to Postgres
//   3. Every 6h   → expire stale IpBlocklist rows from DB
//
// WHY NO BULLMQ:
//   The log drain runs every 60s — BullMQ overhead (ZADD, HSET, LRANGE per job)
//   would cost more Redis commands than the drain itself.
//   Plain setInterval = 2 Redis commands per cycle (LRANGE + LTRIM), nothing more.
//
// COMMAND COUNT:
//   2 commands × 1/min × 1440 min = 2,880 commands/day (was 34,560/day at 5s)
// =============================================================================

import { prisma } from '#config/prisma.js';
import { redis } from '#config/redis.js';
import { logger } from '#config/logger.js';
import { drainScanLogQueue } from '#shared/cache/scan.cache.js';
import { bulkWriteScanLogs } from '../../modules/scan/scan.repository.js';

const DRAIN_INTERVAL_MS = 60_000; // 60s — was 5s, saves ~32k commands/day
const EXPIRE_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h
const DRAIN_BATCH_SIZE = 500;

let _drainInterval = null;
let _expireInterval = null;

// =============================================================================
// LOG DRAIN
// =============================================================================

const runLogDrain = async () => {
  try {
    const entries = await drainScanLogQueue(DRAIN_BATCH_SIZE);
    console.log('[runLogDrain] entries drained:', entries.length);
    if (!entries.length) return;
    console.log('[runLogDrain] first entry:', JSON.stringify(entries[0]));
    await bulkWriteScanLogs(entries);
    console.log('[runLogDrain] bulk write done');
  } catch (err) {
    console.error('[runLogDrain] FAILED:', err.message);
    logger.error({ err: err.message }, '[scan.worker] Log drain cycle failed');
  }
};

// =============================================================================
// IP BLOCKLIST SYNC — runs on startup + every 6h
// =============================================================================

export const syncIpBlocklistToRedis = async () => {
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
        pipeline.set(key, block.reason, 'EX', 60 * 60 * 24 * 30);
      }
    }
    await pipeline.exec();

    logger.info({ count: activeBlocks.length }, '[scan.worker] IP blocklist synced to Redis');
  } catch (err) {
    logger.error({ err: err.message }, '[scan.worker] syncIpBlocklistToRedis failed');
  }
};

const expireIpBlocklistRows = async () => {
  try {
    const result = await prisma.ipBlocklist.updateMany({
      where: { is_active: true, expires_at: { lt: new Date() } },
      data: { is_active: false },
    });
    if (result.count > 0) {
      logger.info({ count: result.count }, '[scan.worker] Expired IP blocklist rows deactivated');
    }
  } catch (err) {
    logger.error({ err: err.message }, '[scan.worker] expireIpBlocklistRows failed');
  }
};

// =============================================================================
// LIFECYCLE
// =============================================================================

export const startScanWorker = async () => {
  // 1. Warm Redis blocklist immediately on startup
  logger.info('[scan.worker] Warming IP blocklist cache...');
  await syncIpBlocklistToRedis();

  // 2. Log drain — every 60s
  _drainInterval = setInterval(runLogDrain, DRAIN_INTERVAL_MS);
  if (_drainInterval.unref) _drainInterval.unref();

  // 3. IP blocklist expiry — every 6h
  _expireInterval = setInterval(expireIpBlocklistRows, EXPIRE_INTERVAL_MS);
  if (_expireInterval.unref) _expireInterval.unref();

  logger.info(
    { drainIntervalMs: DRAIN_INTERVAL_MS },
    '[scan.worker] Started (no BullMQ — plain intervals)'
  );
};

export const stopScanWorker = async () => {
  if (_drainInterval) {
    clearInterval(_drainInterval);
    _drainInterval = null;
  }
  if (_expireInterval) {
    clearInterval(_expireInterval);
    _expireInterval = null;
  }
  // Final drain before shutdown — don't lose buffered logs
  await runLogDrain();
  logger.info('[scan.worker] Stopped');
};
