/**
 * server.js — HTTP server entry point
 * Run: node src/server.js
 *
 * Responsibilities:
 *  - Print startup banner
 *  - Connect to Postgres, Redis
 *  - Start Express
 *  - Graceful shutdown on SIGTERM / SIGINT
 */

import { createApp, printMiddlewareTable } from './app.js';
import { ENV } from './config/env.js';
import { logger } from './config/logger.js';
import { prisma } from './config/prisma.js';
import { redis } from './config/redis.js';
import { jobScheduler } from '#orchestrator/jobs/scheduler.service.js';
import {
  initializeInfrastructure,
  getInfrastructure,
} from './infrastructure/infrastructure.index.js';

import os from 'os';

// =============================================================================
// SAFELY PARSE FIREBASE SERVICE ACCOUNT
// =============================================================================

let firebaseServiceAccount = null;

try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    firebaseServiceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    console.log('✅ Firebase service account loaded successfully');
  } else {
    console.warn('⚠️ FIREBASE_SERVICE_ACCOUNT not set. Push notifications will be disabled.');
  }
} catch (error) {
  console.error('❌ Failed to parse FIREBASE_SERVICE_ACCOUNT:', error.message);
  console.warn('⚠️ Push notifications will be disabled.');
}

// =============================================================================
// INITIALIZE INFRASTRUCTURE WITH FALLBACKS
// =============================================================================

try {
  await initializeInfrastructure({
    cache: {
      REDIS_URL: process.env.REDIS_URL,
    },
    email: {
      API_KEY: process.env.RESEND_API_KEY,
    },
    push: firebaseServiceAccount
      ? {
          serviceAccount: firebaseServiceAccount,
        }
      : null, // Skip push if not configured
    sms: {
      AUTH_KEY: process.env.MSG91_AUTH_KEY,
    },
    storage: {
      BUCKET: process.env.AWS_S3_BUCKET,
    },
  });

  console.log('✅ Infrastructure initialized successfully');
} catch (error) {
  console.error('❌ Infrastructure initialization failed:', error.message);
  // Don't exit - let the server start without some features
}

// ── ANSI helpers ───────────────────────────────────────────────────────────
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[97m',
  bgBlue: '\x1b[44m',
  gray: '\x1b[90m',
};

const ENV_COLOR = {
  production: c.red,
  staging: c.yellow,
  development: c.green,
  test: c.cyan,
};

process.stdout.setEncoding('utf8');

// ── Banner ─────────────────────────────────────────────────────────────────
function printBanner() {
  const ENVColor = ENV_COLOR[ENV.NODE_ENV] ?? c.white;
  const width = 58;
  const line = '═'.repeat(width);
  const blank = ' '.repeat(width);

  console.log(`\n${c.cyan}╔${line}╗${c.reset}`);
  console.log(`${c.cyan}║${blank}║${c.reset}`);
  console.log(
    `${c.cyan}║${c.reset}${c.bold}${c.white}${'  ⬡  SCHOOLCARD BACKEND API'.padEnd(width)}${c.reset}${c.cyan}║${c.reset}`
  );
  console.log(
    `${c.cyan}║${c.reset}${c.dim}${'  Modular · Multi-tenant · Event-driven'.padEnd(width)}${c.reset}${c.cyan}║${c.reset}`
  );
  console.log(`${c.cyan}║${blank}║${c.reset}`);
  console.log(`${c.cyan}╚${line}╝${c.reset}\n`);
}

// ── Info table ─────────────────────────────────────────────────────────────
function printServerInfo(port) {
  const rows = [
    ['Process', `API Server  (PID ${process.pid})`],
    ['ENVironment', ENV.NODE_ENV.toUpperCase()],
    ['Port', String(port)],
    ['Node', process.version],
    ['Platform', `${os.platform()} / ${os.arch()}`],
    ['CPUs', String(os.cpus().length)],
    ['Memory', `${Math.round(os.totalmem() / 1024 / 1024)} MB total`],
    ['Hostname', os.hostname()],
    ['Started', new Date().toISOString()],
    ['Push Notifications', firebaseServiceAccount ? '✅ Enabled' : '⚠️ Disabled'],
    ['Email', process.env.RESEND_API_KEY ? '✅ Configured' : '⚠️ Not configured'],
    ['SMS', process.env.MSG91_AUTH_KEY ? '✅ Configured' : '⚠️ Not configured'],
    ['Storage', process.env.AWS_S3_BUCKET ? '✅ Configured' : '⚠️ Not configured'],
  ];

  const ENVColor = ENV_COLOR[ENV.NODE_ENV] ?? c.white;
  const w1 = 18;
  const separator = `${c.gray}  ${'─'.repeat(52)}${c.reset}`;

  console.log(separator);
  console.log(`  ${c.bold}${c.cyan}Server Info${c.reset}`);
  console.log(separator);

  rows.forEach(([key, val]) => {
    const label = c.dim + key.padEnd(w1) + c.reset;
    let value;

    if (key === 'ENVironment') {
      value = `${ENVColor}${c.bold}${val}${c.reset}`;
    } else if (key === 'Process') {
      value = `${c.green}${val}${c.reset}`;
    } else if (key.includes('Enabled') || key.includes('Configured')) {
      if (val.includes('✅')) {
        value = `${c.green}${val}${c.reset}`;
      } else if (val.includes('⚠️')) {
        value = `${c.yellow}${val}${c.reset}`;
      } else {
        value = `${c.white}${val}${c.reset}`;
      }
    } else {
      value = `${c.white}${val}${c.reset}`;
    }

    console.log(`  ${label}${value}`);
  });

  console.log(separator);
}

// ── URL table ──────────────────────────────────────────────────────────────
function printRouteTable(port) {
  const base = `http://localhost:${port}`;

  const routes = [
    { label: 'Health (live)', url: `${base}/health/live` },
    { label: 'Health (ready)', url: `${base}/health/ready` },
    { label: 'Health (full)', url: `${base}/health` },
    { label: 'Metrics', url: `${base}/health/metrics` },
    { label: 'API v1 — public', url: `${base}/api/v1/public/` },
    { label: 'API v1 — admin', url: `${base}/api/v1/admin/` },
    { label: 'API v1 — parent', url: `${base}/api/v1/parent/` },
    { label: 'API v1 — super', url: `${base}/api/v1/super-admin/` },
    { label: 'Webhooks', url: `${base}/api/webhooks/` },
  ];

  const separator = `${c.gray}  ${'─'.repeat(62)}${c.reset}`;
  console.log(`\n${separator}`);
  console.log(`  ${c.bold}${c.cyan}Endpoints${c.reset}`);
  console.log(separator);

  routes.forEach(({ label, url }) => {
    console.log(`  ${c.dim}${label.padEnd(20)}${c.reset}${c.green}${url}${c.reset}`);
  });

  console.log(separator);
}

// ── Connection checks ──────────────────────────────────────────────────────
async function checkConnections() {
  const separator = `${c.gray}  ${'─'.repeat(46)}${c.reset}`;
  console.log(`\n${separator}`);
  console.log(`  ${c.bold}${c.cyan}Connections${c.reset}`);
  console.log(separator);

  // Postgres
  try {
    await prisma.$queryRaw`SELECT 1`;
    console.log(
      `  ${c.green}●${c.reset} ${c.bold}PostgreSQL${c.reset}     ${c.green}connected${c.reset}`
    );
  } catch (err) {
    console.log(
      `  ${c.red}●${c.reset} ${c.bold}PostgreSQL${c.reset}     ${c.red}FAILED — ${err.message}${c.reset}`
    );
    throw err;
  }

  // Redis
  try {
    await redis.ping();
    console.log(
      `  ${c.green}●${c.reset} ${c.bold}Redis${c.reset}          ${c.green}connected${c.reset}`
    );
  } catch (err) {
    console.log(
      `  ${c.red}●${c.reset} ${c.bold}Redis${c.reset}          ${c.red}FAILED — ${err.message}${c.reset}`
    );
    throw err;
  }

  console.log(separator);
}

// ── Graceful shutdown ──────────────────────────────────────────────────────
function setupGracefulShutdown(server) {
  let isShuttingDown = false;

  async function shutdown(signal) {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.log(`\n${c.yellow}  ⚡ ${signal} received — starting graceful shutdown…${c.reset}`);
    logger.info({ signal }, 'Graceful shutdown initiated');

    // 1. Stop accepting new connections
    server.close(async () => {
      console.log(`  ${c.yellow}●${c.reset} HTTP server closed`);

      try {
        // 2. Stop cron jobs
        await jobScheduler.stop();
        console.log(`  ${c.yellow}●${c.reset} Job scheduler stopped`);

        // 3. Disconnect Prisma
        await prisma.$disconnect();
        console.log(`  ${c.yellow}●${c.reset} PostgreSQL disconnected`);

        // 4. Disconnect Redis
        await redis.quit();
        console.log(`  ${c.yellow}●${c.reset} Redis disconnected`);

        console.log(`  ${c.green}✓ Shutdown complete${c.reset}\n`);
        logger.info('Graceful shutdown complete');
        process.exit(0);
      } catch (err) {
        logger.error({ err }, 'Error during shutdown');
        process.exit(1);
      }
    });

    // Force kill after timeout
    setTimeout(() => {
      logger.error('Shutdown timeout — forcing exit');
      console.error(`\n  ${c.red}✗ Shutdown timeout — forcing exit${c.reset}\n`);
      process.exit(1);
    }, ENV.SHUTDOWN_TIMEOUT_MS ?? 15_000);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('uncaughtException', err => {
    logger.fatal({ err }, 'Uncaught exception');
    console.error(`\n  ${c.red}✗ Uncaught Exception: ${err.message}${c.reset}`);
    console.error(err.stack);
    process.exit(1);
  });

  process.on('unhandledRejection', reason => {
    logger.fatal({ reason }, 'Unhandled rejection');
    console.error(`\n  ${c.red}✗ Unhandled Rejection: ${reason}${c.reset}`);
    process.exit(1);
  });
}

// ── Main ───────────────────────────────────────────────────────────────────
async function start() {
  const PORT = Number(ENV.PORT ?? 3000);

  try {
    printBanner();
    printServerInfo(PORT);

    // 1. Check connections before accepting traffic
    await checkConnections();

    // 2. Build Express app
    const app = createApp();

    // 3. Print middleware list
    printMiddlewareTable();

    // 4. Start listening
    const server = app.listen(PORT, () => {
      printRouteTable(PORT);
      console.log(`\n  ${c.green}${c.bold}✓ API server ready on port ${PORT}${c.reset}\n`);
      logger.info({ port: PORT, ENV: ENV.NODE_ENV }, 'API server started');
    });

    // 5. Keep-alive tuning for Railway (avoids ECONNRESET on deployed ENVs)
    server.keepAliveTimeout = 65_000;
    server.headersTimeout = 66_000;

    // 6. Start cron jobs (after server is up)
    await jobScheduler.start();
    console.log(`  ${c.cyan}●${c.reset} ${c.bold}Cron scheduler${c.reset}  started`);

    // 7. Graceful shutdown hooks
    setupGracefulShutdown(server);
  } catch (err) {
    logger.fatal({ err }, 'Failed to start API server');
    console.error(`\n  ${c.red}✗ Startup failed: ${err.message}${c.reset}\n`);
    process.exit(1);
  }
}

start();
