/**
 * server.js — RESQID API Server Entry Point
 * ─────────────────────────────────────────
 * coreZ Technologies Pvt. Ltd.
 * Run: node src/server.js
 */

import { createApp, printMiddlewareTable } from './app.js';
import { ENV } from './config/env.js';
import { logger } from './config/logger.js';
import { prisma } from './config/prisma.js';
import { redis } from './config/redis.js';
import { jobScheduler } from '#orchestrator/jobs/scheduler.service.js';
import { initializeInfrastructure } from './infrastructure/infrastructure.index.js';
import os from 'os';

// ── ANSI palette ───────────────────────────────────────────────────────────
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  ul: '\x1b[4m',
  blink: '\x1b[5m',

  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[97m',
  gray: '\x1b[90m',
  orange: '\x1b[38;5;208m',
  violet: '\x1b[38;5;141m',
  mint: '\x1b[38;5;121m',
  coral: '\x1b[38;5;203m',
  gold: '\x1b[38;5;220m',
  sky: '\x1b[38;5;117m',

  bgBlack: '\x1b[40m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgBlue: '\x1b[44m',
  bgCyan: '\x1b[46m',
};

const ENV_COLOR = {
  production: c.coral,
  staging: c.gold,
  development: c.mint,
  test: c.sky,
};

process.stdout.setEncoding('utf8');

// ── Helpers ────────────────────────────────────────────────────────────────
const pad = (s, n, ch = ' ') => String(s).padEnd(n, ch);
const padL = (s, n, ch = ' ') => String(s).padStart(n, ch);
const line = (ch, n) => ch.repeat(n);
const ok = `${c.green}${c.bold}✓${c.reset}`;
const fail = `${c.red}${c.bold}✗${c.reset}`;
const warn = `${c.gold}${c.bold}⚠${c.reset}`;
const dot = (col = c.cyan) => `${col}●${c.reset}`;
const badge = (text, col = c.bgBlue + c.white) => `${col}${c.bold} ${text} ${c.reset}`;

// ── Infrastructure init ────────────────────────────────────────────────────
try {
  await initializeInfrastructure({
    cache: { REDIS_URL: process.env.REDIS_URL },
    email: { API_KEY: process.env.BREVO_API_KEY },
    push: null, // Expo handles push, not Firebase
    sms: { AUTH_KEY: process.env.TWOFACTOR_API_KEY },
    storage: { BUCKET: process.env.AWS_S3_BUCKET },
  });
} catch {
  // graceful degradation — server starts without some services
}

// ══════════════════════════════════════════════════════════════════════════
// BANNER
// ══════════════════════════════════════════════════════════════════════════
function printBanner() {
  const W = 64;
  const box = {
    tl: '╔',
    tr: '╗',
    bl: '╚',
    br: '╝',
    h: '═',
    v: '║',
    ml: '╠',
    mr: '╣',
  };

  const hl = c.cyan;
  const blank = ' '.repeat(W);

  const row = (text = '', textCol = c.reset) => {
    const visible = text.replace(/\x1b\[[0-9;]*m/g, '');
    const pad = W - visible.length;
    return `${hl}${box.v}${c.reset}${textCol}${text}${' '.repeat(Math.max(0, pad))}${c.reset}${hl}${box.v}${c.reset}`;
  };

  const divider = `${hl}${box.ml}${box.h.repeat(W)}${box.mr}${c.reset}`;

  console.log('');
  console.log(`${hl}${box.tl}${box.h.repeat(W)}${box.tr}${c.reset}`);
  console.log(row());
  console.log(
    row(`  ${c.bold}${c.white}⬡  RESQID${c.reset}${c.dim}  by coreZ Technologies Pvt. Ltd.`)
  );
  console.log(row(`  ${c.dim}QR-based Student Emergency Identity System`));
  console.log(row());
  console.log(divider);
  console.log(row());
  console.log(
    row(
      `  ${c.cyan}${c.bold}API SERVER${c.reset}` +
        `  ${c.gray}·${c.reset}  ` +
        `${c.dim}Modular  ·  Multi-tenant  ·  Event-driven${c.reset}`
    )
  );
  console.log(row());
  console.log(`${hl}${box.bl}${box.h.repeat(W)}${box.br}${c.reset}`);
  console.log('');
}

// ══════════════════════════════════════════════════════════════════════════
// SERVER INFO TABLE
// ══════════════════════════════════════════════════════════════════════════
function printServerInfo(port) {
  const envCol = ENV_COLOR[ENV.NODE_ENV] ?? c.white;
  const env = ENV.NODE_ENV.toUpperCase();
  const W = 56;
  const SEP = `  ${c.gray}${'─'.repeat(W)}${c.reset}`;

  const serviceStatus = (has, label) =>
    has ? `${c.green}${c.bold}▲ ${label}${c.reset}` : `${c.gray}○ ${label}${c.reset}`;

  const rows = [
    ['Role', `${c.cyan}${c.bold}API Server${c.reset}  ${c.gray}PID ${process.pid}${c.reset}`],
    ['Environment', `${envCol}${c.bold}${env}${c.reset}`],
    ['Port', `${c.white}${c.bold}:${port}${c.reset}`],
    ['Node', `${c.dim}${process.version}${c.reset}`],
    ['Platform', `${c.dim}${os.platform()} / ${os.arch()}${c.reset}`],
    ['CPUs', `${c.dim}${os.cpus().length} cores${c.reset}`],
    ['Memory', `${c.dim}${Math.round(os.totalmem() / 1024 / 1024)} MB${c.reset}`],
    ['Host', `${c.dim}${os.hostname()}${c.reset}`],
    ['Started', `${c.dim}${new Date().toISOString()}${c.reset}`],
  ];

  console.log(SEP);
  console.log(`  ${c.bold}${c.cyan}Server${c.reset}`);
  console.log(SEP);

  rows.forEach(([key, val]) => {
    console.log(`  ${c.dim}${pad(key, 14)}${c.reset}${val}`);
  });

  console.log('');

  // Services sub-block
  const services = [
    [process.env.EXPO_ACCESS_TOKEN, 'Push'],
    [process.env.SMTP_USER || process.env.BREVO_API_KEY, 'Email'],
    [process.env.TWOFACTOR_API_KEY, 'SMS'],
    [process.env.AWS_S3_BUCKET, 'Storage'],
    [process.env.REDIS_URL, 'Redis'],
    [process.env.DATABASE_URL, 'Postgres'],
  ];

  console.log(
    `  ${c.dim}${'Services'.padEnd(14)}${c.reset}` +
      services.map(([has, label]) => serviceStatus(has, label)).join(`  ${c.gray}·${c.reset}  `)
  );

  console.log(SEP);
}

// ══════════════════════════════════════════════════════════════════════════
// CONNECTION CHECKS
// ══════════════════════════════════════════════════════════════════════════
async function checkConnections() {
  const W = 46;
  const SEP = `  ${c.gray}${'─'.repeat(W)}${c.reset}`;

  console.log(`\n${SEP}`);
  console.log(`  ${c.bold}${c.cyan}Connections${c.reset}`);
  console.log(SEP);

  // Postgres
  const pgStart = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    const ms = Date.now() - pgStart;
    console.log(
      `  ${ok}  ${c.bold}${pad('PostgreSQL', 14)}${c.reset}` +
        `${c.green}connected${c.reset}  ${c.gray}${ms}ms${c.reset}`
    );
  } catch (err) {
    console.log(
      `  ${fail}  ${c.bold}${pad('PostgreSQL', 14)}${c.reset}${c.red}${err.message}${c.reset}`
    );
    throw err;
  }

  // Redis
  const rdStart = Date.now();
  try {
    await redis.ping();
    const ms = Date.now() - rdStart;
    console.log(
      `  ${ok}  ${c.bold}${pad('Redis', 14)}${c.reset}` +
        `${c.green}connected${c.reset}  ${c.gray}${ms}ms${c.reset}`
    );
  } catch (err) {
    console.log(
      `  ${warn}  ${c.bold}${pad('Redis', 14)}${c.reset}${c.gold}${err.message}${c.reset}`
    );
    // Don't throw — allow server to start with degraded Redis
    logger.warn({ err: err.message }, 'Redis connection failed — starting in degraded mode');
  }

  console.log(SEP);
}

// ══════════════════════════════════════════════════════════════════════════
// ROUTE TABLE
// ══════════════════════════════════════════════════════════════════════════
function printRouteTable(port) {
  const base = `http://localhost:${port}`;

  const groups = [
    {
      label: 'Health',
      col: c.mint,
      routes: [
        ['GET', '/health/live', 'Liveness probe'],
        ['GET', '/health/ready', 'Readiness probe'],
        ['GET', '/health', 'Full health report'],
        ['GET', '/health/metrics', 'Prometheus metrics'],
      ],
    },
    {
      label: 'API v1',
      col: c.sky,
      routes: [
        ['*', '/api/v1/public/', 'Public — no auth'],
        ['*', '/api/v1/admin/', 'School admin'],
        ['*', '/api/v1/parent/', 'Parent / guardian'],
        ['*', '/api/v1/super-admin/', 'Super admin'],
        ['*', '/api/webhooks/', 'Incoming webhooks'],
      ],
    },
  ];

  const W = 62;
  const SEP = `  ${c.gray}${'─'.repeat(W)}${c.reset}`;

  console.log(`\n${SEP}`);
  console.log(`  ${c.bold}${c.cyan}Endpoints${c.reset}`);
  console.log(SEP);

  groups.forEach(({ label, col, routes }) => {
    console.log(`  ${col}${c.bold}${label}${c.reset}`);
    routes.forEach(([method, path, desc]) => {
      const methodStr =
        method === 'GET'
          ? `${c.green}${pad(method, 4)}${c.reset}`
          : method === '*'
            ? `${c.gray}${pad('ANY', 4)}${c.reset}`
            : `${c.yellow}${pad(method, 4)}${c.reset}`;
      console.log(
        `    ${methodStr}  ${c.white}${pad(path, 30)}${c.reset}` + `${c.dim}${desc}${c.reset}`
      );
    });
    console.log('');
  });

  console.log(SEP);
}

// ══════════════════════════════════════════════════════════════════════════
// WORKER TOPOLOGY — Updated for new queue architecture
// ══════════════════════════════════════════════════════════════════════════
function printWorkerTopology() {
  const PHASE_1_WORKERS = [
    {
      role: 'RAILWAY (24/7)',
      col: c.violet,
      badge: '☁ Railway',
      workers: [
        { name: 'EmergencyWorker', queue: 'emergency_queue', conc: 10 },
        { name: 'NotificationWorker', queue: 'notification_queue', conc: 5 },
        { name: 'ScanWorker', queue: 'setInterval/60s', conc: 1 },
        { name: 'MaintenanceWorker', queue: 'setInterval/24h', conc: 1 },
      ],
    },
    {
      role: 'LOCAL (on-demand)',
      col: c.orange,
      badge: '⚙ Local Dev',
      workers: [
        { name: 'PipelineWorker', queue: 'pipeline_queue', conc: 3 },
        { name: 'DesignWorker', queue: 'pipeline_queue', conc: 1 },
      ],
    },
  ];

  const W = 62;
  const SEP = `  ${c.gray}${'─'.repeat(W)}${c.reset}`;

  console.log(`\n${SEP}`);
  console.log(
    `  ${c.bold}${c.cyan}Worker Topology${c.reset}  ${c.dim}Phase 1 — separate process${c.reset}`
  );
  console.log(SEP);

  PHASE_1_WORKERS.forEach(({ col, badge: b, workers }) => {
    console.log(`  ${col}${c.bold}${b}${c.reset}`);
    workers.forEach(({ name, queue, conc }) => {
      console.log(
        `    ${dot(col)}  ${c.bold}${pad(name, 22)}${c.reset}` +
          `${c.dim}queue:${c.reset} ${c.sky}${pad(queue, 18)}${c.reset}` +
          `${c.gray}×${conc}${c.reset}`
      );
    });
    console.log('');
  });

  console.log(
    `  ${c.dim}Start Railway workers:${c.reset}  ${c.white}npm run worker:easy${c.reset}  ${c.gray}(WORKER_ROLE=all)${c.reset}`
  );
  console.log(
    `  ${c.dim}Start local pipeline:${c.reset}   ${c.white}npm run worker:pipeline${c.reset}`
  );
  console.log(
    `  ${c.dim}Start local design:${c.reset}     ${c.white}npm run worker:design${c.reset}`
  );
  console.log(SEP);
}

// ══════════════════════════════════════════════════════════════════════════
// GRACEFUL SHUTDOWN
// ══════════════════════════════════════════════════════════════════════════
function setupGracefulShutdown(server) {
  let isShuttingDown = false;

  async function shutdown(signal) {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.log(`\n  ${c.gold}⚡ ${signal} received — graceful shutdown starting…${c.reset}`);
    logger.info({ signal }, 'Graceful shutdown initiated');

    const step = label => console.log(`  ${c.yellow}›${c.reset} ${c.dim}${label}${c.reset}`);

    server.close(async () => {
      step('HTTP server closed — no new connections');

      try {
        step('Stopping job scheduler…');
        await jobScheduler.stop();
        step('Disconnecting PostgreSQL…');
        await prisma.$disconnect();
        step('Disconnecting Redis…');
        await redis.quit();

        console.log(`\n  ${ok}  ${c.bold}${c.green}Shutdown complete${c.reset}\n`);
        logger.info('Graceful shutdown complete');
        process.exit(0);
      } catch (err) {
        logger.error({ err }, 'Error during shutdown');
        process.exit(1);
      }
    });

    setTimeout(() => {
      logger.error('Shutdown timeout — forcing exit');
      console.error(`\n  ${fail}  ${c.red}Shutdown timeout — forcing exit${c.reset}\n`);
      process.exit(1);
    }, ENV.SHUTDOWN_TIMEOUT_MS ?? 15_000);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('uncaughtException', err => {
    logger.fatal({ err }, 'Uncaught exception');
    console.error(`\n  ${fail}  ${c.red}Uncaught Exception: ${err.message}${c.reset}`);
    console.error(err.stack);
    process.exit(1);
  });

  process.on('unhandledRejection', reason => {
    logger.fatal({ reason }, 'Unhandled rejection');
    console.error(`\n  ${fail}  ${c.red}Unhandled Rejection: ${reason}${c.reset}`);
    process.exit(1);
  });
}

// ══════════════════════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════════════════════
async function start() {
  const PORT = Number(ENV.PORT ?? 3000);

  try {
    printBanner();
    printServerInfo(PORT);

    await checkConnections();

    const app = createApp();
    printMiddlewareTable();
    printWorkerTopology();

    const server = app.listen(PORT, () => {
      printRouteTable(PORT);
      console.log(
        `\n  ${ok}  ${c.bold}${c.green}API server ready${c.reset}  ${c.gray}→${c.reset}  ${c.white}http://localhost:${PORT}${c.reset}\n`
      );
      logger.info({ port: PORT, env: ENV.NODE_ENV }, 'API server started');
    });

    // Railway keep-alive tuning
    server.keepAliveTimeout = 65_000;
    server.headersTimeout = 66_000;

    await jobScheduler.start();
    console.log(`  ${dot(c.cyan)}  ${c.bold}Cron scheduler${c.reset}  ${c.green}started${c.reset}`);

    setupGracefulShutdown(server);
  } catch (err) {
    logger.fatal({ err }, 'Failed to start API server');
    console.error(`\n  ${fail}  ${c.red}Startup failed: ${err.message}${c.reset}\n`);
    process.exit(1);
  }
}

start();
