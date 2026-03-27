/**
 * worker.js — BullMQ worker process entry point
 * Run: node src/worker.js
 *
 * This process has NO HTTP server.
 * It connects to the same Postgres + Redis as server.js,
 * registers all workers from modules
 * /*/
//  * and runs until SIGTERM / SIGINT.
//  * On Railway: add a second service pointing to "node src/worker.js"
// * Zero code changes required to split from server.js.

import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { prisma } from './config/prisma.js';
import { redis } from './config/redis.js';
import os from 'os';

// ── Worker imports — all workers register here ─────────────────────────────
// Scan
import { ScanWorker } from './modules/scan/scan.worker.js';

// Token
import { TokenWorker } from './modules/token/token.worker.js';

// Card
import { CardWorker } from './modules/card/card.worker.js';

// Notification
import { NotificationWorker } from './modules/notification/notification.worker.js';

// Order orchestration — all 7 from one barrel export
import {
  CancelWorker,
  CardOrchestratorWorker,
  DesignWorker,
  FailureWorker,
  InvoiceNotificationWorker,
  TokenOrchestratorWorker,
} from './modules/order/order_orchestrator/workers/index.js';

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
  gray: '\x1b[90m',
};

// ── Worker registry — name, class, concurrency, description ───────────────
const WORKER_REGISTRY = [
  {
    name: 'scan',
    Worker: ScanWorker,
    concurrency: 20,
    desc: 'QR scan events + anomaly detection',
    queue: 'scan:process',
  },
  {
    name: 'token',
    Worker: TokenWorker,
    concurrency: 5,
    desc: 'Student token generation (batch)',
    queue: 'token:generate',
  },
  {
    name: 'card',
    Worker: CardWorker,
    concurrency: 2, // CPU-heavy — keep low
    desc: 'Card design generation (CPU-heavy)',
    queue: 'card:generate',
  },
  {
    name: 'notification',
    Worker: NotificationWorker,
    concurrency: 10,
    desc: 'Email + SMS dispatch',
    queue: 'notification:send',
  },
  {
    name: 'order:cancel',
    Worker: CancelWorker,
    concurrency: 5,
    desc: 'Order cancellation handler',
    queue: 'order:cancel',
  },
  {
    name: 'order:card',
    Worker: CardOrchestratorWorker,
    concurrency: 2,
    desc: 'Card step in order pipeline',
    queue: 'order:card',
  },
  {
    name: 'order:design',
    Worker: DesignWorker,
    concurrency: 2,
    desc: 'Design step in order pipeline',
    queue: 'order:design',
  },
  {
    name: 'order:failure',
    Worker: FailureWorker,
    concurrency: 5,
    desc: 'Dead-letter / failure handler',
    queue: 'order:failure',
  },
  {
    name: 'order:invoice-notify',
    Worker: InvoiceNotificationWorker,
    concurrency: 5,
    desc: 'Invoice generation + notification',
    queue: 'order:invoice-notify',
  },
  {
    name: 'order:token',
    Worker: TokenOrchestratorWorker,
    concurrency: 5,
    desc: 'Token step in order pipeline',
    queue: 'order:token',
  },
];

// ── Banner ─────────────────────────────────────────────────────────────────
function printBanner() {
  const width = 58;
  const line = '═'.repeat(width);
  const blank = ' '.repeat(width);

  console.log(`\n${c.magenta}╔${line}╗${c.reset}`);
  console.log(`${c.magenta}║${blank}║${c.reset}`);
  console.log(
    `${c.magenta}║${c.reset}${c.bold}${c.white}${'  ⚙  SCHOOLCARD WORKER PROCESS'.padEnd(width)}${c.reset}${c.magenta}║${c.reset}`
  );
  console.log(
    `${c.magenta}║${c.reset}${c.dim}${'  BullMQ · Redis · PostgreSQL'.padEnd(width)}${c.reset}${c.magenta}║${c.reset}`
  );
  console.log(`${c.magenta}║${blank}║${c.reset}`);
  console.log(`${c.magenta}╚${line}╝${c.reset}\n`);
}

// ── Info table ─────────────────────────────────────────────────────────────
function printWorkerInfo() {
  const rows = [
    ['Process', `Worker Process  (PID ${process.pid})`],
    ['Environment', env.NODE_ENV.toUpperCase()],
    ['Node', process.version],
    ['CPUs', String(os.cpus().length)],
    ['Memory', `${Math.round(os.totalmem() / 1024 / 1024)} MB total`],
    ['Workers', String(WORKER_REGISTRY.length)],
    ['Started', new Date().toISOString()],
  ];

  const w1 = 14;
  const separator = `${c.gray}  ${'─'.repeat(50)}${c.reset}`;

  console.log(separator);
  console.log(`  ${c.bold}${c.magenta}Worker Process Info${c.reset}`);
  console.log(separator);

  rows.forEach(([key, val]) => {
    const label = c.dim + key.padEnd(w1) + c.reset;
    const value =
      key === 'Environment'
        ? `${c.yellow}${c.bold}${val}${c.reset}`
        : key === 'Process'
          ? `${c.magenta}${val}${c.reset}`
          : key === 'Workers'
            ? `${c.green}${c.bold}${val}${c.reset}`
            : `${c.white}${val}${c.reset}`;
    console.log(`  ${label}${value}`);
  });

  console.log(separator);
}

// ── Connection checks ──────────────────────────────────────────────────────
async function checkConnections() {
  const separator = `${c.gray}  ${'─'.repeat(50)}${c.reset}`;
  console.log(`\n${separator}`);
  console.log(`  ${c.bold}${c.magenta}Connections${c.reset}`);
  console.log(separator);

  try {
    await prisma.$queryRaw`SELECT 1`;
    console.log(
      `  ${c.green}●${c.reset} ${c.bold}PostgreSQL${c.reset}    ${c.green}connected${c.reset}`
    );
  } catch (err) {
    console.log(
      `  ${c.red}●${c.reset} ${c.bold}PostgreSQL${c.reset}    ${c.red}FAILED — ${err.message}${c.reset}`
    );
    throw err;
  }

  try {
    await redis.ping();
    console.log(
      `  ${c.green}●${c.reset} ${c.bold}Redis${c.reset}         ${c.green}connected${c.reset}`
    );
  } catch (err) {
    console.log(
      `  ${c.red}●${c.reset} ${c.bold}Redis${c.reset}         ${c.red}FAILED — ${err.message}${c.reset}`
    );
    throw err;
  }

  console.log(separator);
}

// ── Worker table ───────────────────────────────────────────────────────────
function printWorkerTable(instances) {
  const w1 = 22,
    w2 = 6,
    w3 = 34;
  const separator = `${c.gray}  ${'─'.repeat(w1 + w2 + w3 + 6)}${c.reset}`;

  console.log(`\n${separator}`);
  console.log(`  ${c.bold}${c.magenta}Active Workers${c.reset}`);
  console.log(separator);
  console.log(
    `  ${c.dim}${'Worker'.padEnd(w1)} ${'Conc'.padEnd(w2)} ${'Queue → Description'.padEnd(w3)}${c.reset}`
  );
  console.log(separator);

  instances.forEach(({ name, concurrency, desc, queue }) => {
    const dot = `${c.green}●${c.reset}`;
    const label = c.bold + name.padEnd(w1) + c.reset;
    const conc = c.cyan + `×${concurrency}`.padEnd(w2) + c.reset;
    const info = c.dim + `${queue}  ${desc}`.substring(0, w3) + c.reset;
    console.log(`  ${dot} ${label}${conc}${info}`);
  });

  console.log(separator);
  console.log(`\n  ${c.green}${c.bold}✓ ${instances.length} workers running${c.reset}\n`);
}

// ── Runtime stats (printed every 60s in development) ──────────────────────
function startStatsPrinter(instances) {
  if (env.NODE_ENV === 'production') return;

  setInterval(() => {
    const mem = process.memoryUsage();
    const rss = Math.round(mem.rss / 1024 / 1024);
    const heap = Math.round(mem.heapUsed / 1024 / 1024);
    const ext = Math.round(mem.external / 1024 / 1024);

    console.log(
      `\n  ${c.dim}[${new Date().toISOString()}]${c.reset} ` +
        `${c.cyan}RSS${c.reset} ${rss}MB  ` +
        `${c.cyan}Heap${c.reset} ${heap}MB  ` +
        `${c.cyan}Ext${c.reset} ${ext}MB  ` +
        `${c.green}Workers${c.reset} ${instances.length} active`
    );
  }, 60_000);
}

// ── Graceful shutdown ──────────────────────────────────────────────────────
function setupGracefulShutdown(instances) {
  let isShuttingDown = false;

  async function shutdown(signal) {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.log(`\n${c.yellow}  ⚡ ${signal} received — draining workers…${c.reset}`);
    logger.info({ signal }, 'Worker graceful shutdown initiated');

    try {
      // Close all workers — BullMQ drains in-flight jobs before closing
      await Promise.all(
        instances.map(async ({ name, instance }) => {
          await instance.close();
          console.log(`  ${c.yellow}●${c.reset} Worker ${c.bold}${name}${c.reset} drained`);
        })
      );

      // Disconnect Prisma
      await prisma.$disconnect();
      console.log(`  ${c.yellow}●${c.reset} PostgreSQL disconnected`);

      // Disconnect Redis
      await redis.quit();
      console.log(`  ${c.yellow}●${c.reset} Redis disconnected`);

      console.log(`\n  ${c.green}✓ All workers drained — shutdown complete${c.reset}\n`);
      logger.info('Worker shutdown complete');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Error during worker shutdown');
      console.error(`\n  ${c.red}✗ Shutdown error: ${err.message}${c.reset}`);
      process.exit(1);
    }
  }

  // Force kill after timeout — Railway sends SIGTERM then SIGKILL after 10s
  const TIMEOUT = env.SHUTDOWN_TIMEOUT_MS ?? 30_000; // workers need more time to drain
  setTimeout(() => {
    if (!isShuttingDown) return;
    logger.error('Worker shutdown timeout — forcing exit');
    console.error(`\n  ${c.red}✗ Shutdown timeout — forcing exit${c.reset}\n`);
    process.exit(1);
  }, TIMEOUT).unref();

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('uncaughtException', err => {
    logger.fatal({ err }, 'Uncaught exception in worker process');
    console.error(`\n  ${c.red}✗ Uncaught Exception: ${err.message}${c.reset}`);
    console.error(err.stack);
    process.exit(1);
  });

  process.on('unhandledRejection', reason => {
    logger.fatal({ reason }, 'Unhandled rejection in worker process');
    console.error(`\n  ${c.red}✗ Unhandled Rejection: ${reason}${c.reset}`);
    process.exit(1);
  });
}

// ── Main ───────────────────────────────────────────────────────────────────
async function start() {
  try {
    printBanner();
    printWorkerInfo();

    // 1. Check DB + Redis before starting workers
    await checkConnections();

    // 2. Instantiate all workers
    const instances = WORKER_REGISTRY.map(({ name, Worker, concurrency, desc, queue }) => {
      const instance = new Worker({ concurrency });

      // Per-worker event hooks for terminal visibility
      instance.on('completed', job => {
        logger.debug({ jobId: job.id, worker: name }, 'Job completed');
        if (env.NODE_ENV !== 'production') {
          console.log(
            `  ${c.green}✓${c.reset} ${c.dim}[${name}]${c.reset} ` +
              `job ${c.bold}${job.id}${c.reset} ${c.green}completed${c.reset}`
          );
        }
      });

      instance.on('failed', (job, err) => {
        logger.error({ jobId: job?.id, worker: name, err }, 'Job failed');
        console.log(
          `  ${c.red}✗${c.reset} ${c.dim}[${name}]${c.reset} ` +
            `job ${c.bold}${job?.id}${c.reset} ${c.red}FAILED${c.reset}: ${err.message}`
        );
      });

      instance.on('stalled', jobId => {
        logger.warn({ jobId, worker: name }, 'Job stalled');
        console.log(
          `  ${c.yellow}⚠${c.reset} ${c.dim}[${name}]${c.reset} ` +
            `job ${c.bold}${jobId}${c.reset} ${c.yellow}stalled${c.reset}`
        );
      });

      instance.on('error', err => {
        logger.error({ worker: name, err }, 'Worker error');
        console.log(
          `  ${c.red}✗${c.reset} ${c.dim}[${name}]${c.reset} ` +
            `worker error: ${c.red}${err.message}${c.reset}`
        );
      });

      return { name, instance, concurrency, desc, queue };
    });

    // 3. Print worker table
    printWorkerTable(instances);

    // 4. Runtime stats printer (dev only)
    startStatsPrinter(instances);

    // 5. Graceful shutdown
    setupGracefulShutdown(instances);

    logger.info({ workers: WORKER_REGISTRY.map(w => w.name) }, 'Worker process started');
  } catch (err) {
    logger.fatal({ err }, 'Failed to start worker process');
    console.error(`\n  ${c.red}✗ Worker startup failed: ${err.message}${c.reset}\n`);
    process.exit(1);
  }
}

start();
