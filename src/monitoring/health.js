/**
 * monitoring/health.js
 *
 * Endpoints:
 *   GET /health          → full system health (all checks)
 *   GET /health/live     → liveness  (is the process alive?)
 *   GET /health/ready    → readiness (can it serve traffic?)
 *   GET /health/metrics  → lightweight runtime metrics
 *   GET /health/ping     → dead-simple 200 "pong"
 *
 * Use /health/live  for Railway/Docker HEALTHCHECK
 * Use /health/ready for load balancer readiness probe
 * Use /health       for your own dashboards / alerting
 */

import { Router } from 'express';
import os from 'os';
import { prisma } from '#config/prisma.js';
import { redis } from '#config/redis.js';
import { ENV } from '#config/ENV.js';
import { logger } from '#config/logger.js';

export const healthRouter = Router();

// ── Helpers ────────────────────────────────────────────────────────────────
const startTime = Date.now();

function uptimeSeconds() {
  return Math.floor(process.uptime());
}

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${d}d ${h}h ${m}m ${s}s`;
}

function memoryStats() {
  const m = process.memoryUsage();
  return {
    rss: `${Math.round(m.rss / 1024 / 1024)} MB`,
    heapUsed: `${Math.round(m.heapUsed / 1024 / 1024)} MB`,
    heapTotal: `${Math.round(m.heapTotal / 1024 / 1024)} MB`,
    external: `${Math.round(m.external / 1024 / 1024)} MB`,
    arrayBuffers: `${Math.round(m.arrayBuffers / 1024 / 1024)} MB`,
  };
}

function systemStats() {
  const load = os.loadavg();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;

  return {
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    cpus: os.cpus().length,
    loadAvg: {
      '1m': load[0].toFixed(2),
      '5m': load[1].toFixed(2),
      '15m': load[2].toFixed(2),
    },
    memory: {
      total: `${Math.round(totalMem / 1024 / 1024)} MB`,
      used: `${Math.round(usedMem / 1024 / 1024)} MB`,
      free: `${Math.round(freeMem / 1024 / 1024)} MB`,
      usedPercent: `${Math.round((usedMem / totalMem) * 100)}%`,
    },
  };
}

// ── Individual checks ──────────────────────────────────────────────────────
async function checkPostgres() {
  const start = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { status: 'healthy', latencyMs: Date.now() - start };
  } catch (err) {
    logger.warn({ err }, 'Health check: Postgres failed');
    return {
      status: 'unhealthy',
      error: err.message,
      latencyMs: Date.now() - start,
    };
  }
}

async function checkRedis() {
  const start = Date.now();
  try {
    const pong = await redis.ping();
    return {
      status: pong === 'PONG' ? 'healthy' : 'degraded',
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    logger.warn({ err }, 'Health check: Redis failed');
    return {
      status: 'unhealthy',
      error: err.message,
      latencyMs: Date.now() - start,
    };
  }
}

async function checkDiskSpace() {
  // Simple check — see if we can write to the tmp dir
  try {
    const { statfsSync } = await import('fs');
    const stats = statfsSync('/tmp');
    const freeGB = ((stats.bfree * stats.bsize) / 1024 ** 3).toFixed(2);
    const totalGB = ((stats.blocks * stats.bsize) / 1024 ** 3).toFixed(2);
    const usedPercent = Math.round(((stats.blocks - stats.bfree) / stats.blocks) * 100);
    return {
      status: usedPercent > 90 ? 'degraded' : 'healthy',
      free: `${freeGB} GB`,
      total: `${totalGB} GB`,
      usedPercent: `${usedPercent}%`,
    };
  } catch {
    return { status: 'unknown', note: 'statfs not available on this platform' };
  }
}

// ── Aggregate health ───────────────────────────────────────────────────────
function aggregateStatus(checks) {
  const statuses = Object.values(checks).map(c => c.status);
  if (statuses.some(s => s === 'unhealthy')) return 'unhealthy';
  if (statuses.some(s => s === 'degraded')) return 'degraded';
  return 'healthy';
}

// ═══════════════════════════════════════════════════════════════════════════
//  Routes
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /health/ping
 * Absolute minimum — just proves the process is alive.
 * Use for Docker HEALTHCHECK interval.
 */
healthRouter.get('/ping', (_req, res) => {
  res.status(200).json({ pong: true, ts: Date.now() });
});

/**
 * GET /health/live
 * Liveness probe — is the Node process alive and the event loop unblocked?
 * Should NEVER check external dependencies.
 * If this fails, the container should be restarted.
 */
healthRouter.get('/live', (_req, res) => {
  res.status(200).json({
    status: 'alive',
    pid: process.pid,
    uptime: formatUptime(uptimeSeconds()),
    uptimeSeconds: uptimeSeconds(),
    memory: memoryStats(),
    ts: new Date().toISOString(),
  });
});

/**
 * GET /health/ready
 * Readiness probe — can this instance serve traffic?
 * Checks DB + Redis. If unhealthy, load balancer should stop routing here.
 * Responds quickly (parallel checks, ~500ms max).
 */
healthRouter.get('/ready', async (_req, res) => {
  const [postgres, redisCheck] = await Promise.all([checkPostgres(), checkRedis()]);

  const checks = { postgres, redis: redisCheck };
  const status = aggregateStatus(checks);
  const httpStatus = status === 'healthy' ? 200 : 503;

  res.status(httpStatus).json({
    status,
    checks,
    uptime: formatUptime(uptimeSeconds()),
    ts: new Date().toISOString(),
  });
});

/**
 * GET /health/metrics
 * Runtime metrics — memory, CPU load, uptime.
 * No external checks. Safe to call frequently.
 */
healthRouter.get('/metrics', (_req, res) => {
  res.status(200).json({
    process: {
      pid: process.pid,
      nodeVersion: process.version,
      uptime: formatUptime(uptimeSeconds()),
      uptimeSeconds: uptimeSeconds(),
      startedAt: new Date(startTime).toISOString(),
      memory: memoryStats(),
    },
    system: systemStats(),
    ENV: {
      nodeENV: ENV.NODE_ENV,
      port: ENV.PORT ?? 3000,
    },
    ts: new Date().toISOString(),
  });
});

/**
 * GET /health
 * Full system health — all checks, full detail.
 * Slower (sequential + parallel checks). Use for dashboards, not probes.
 */
healthRouter.get('/', async (_req, res) => {
  const checkStart = Date.now();

  const [postgres, redisCheck, disk] = await Promise.all([
    checkPostgres(),
    checkRedis(),
    checkDiskSpace(),
  ]);

  const checks = {
    postgres,
    redis: redisCheck,
    disk,
  };

  const status = aggregateStatus(checks);
  const httpStatus = status === 'healthy' ? 200 : status === 'degraded' ? 200 : 503;

  const response = {
    status,
    version: ENV.APP_VERSION ?? '1.0.0',
    service: 'schoolcard-api',
    ENV: ENV.NODE_ENV,

    checks,

    process: {
      pid: process.pid,
      nodeVersion: process.version,
      uptime: formatUptime(uptimeSeconds()),
      uptimeSeconds: uptimeSeconds(),
      startedAt: new Date(startTime).toISOString(),
      memory: memoryStats(),
    },

    system: systemStats(),

    meta: {
      checkDurationMs: Date.now() - checkStart,
      ts: new Date().toISOString(),
    },
  };

  if (status !== 'healthy') {
    logger.warn({ status, checks }, 'Health check returned non-healthy status');
  }

  res.status(httpStatus).json(response);
});
