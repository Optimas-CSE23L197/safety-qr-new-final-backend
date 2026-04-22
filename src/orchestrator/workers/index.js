// =============================================================================
// orchestrator/workers/index.js — RESQID
//
// RAILWAY (always on):
//   WORKER_ROLE=emergency     → EmergencyWorker only
//   WORKER_ROLE=notification  → NotificationWorker only
//   WORKER_ROLE=all           → Emergency + Notification + Scan + Maintenance
//
// LOCAL ONLY (run when needed, Ctrl+C when done):
//   npm run worker:pipeline   → PipelineWorker (token generation for orders)
//   npm run worker:design     → DesignWorker (PDF card generation for vendor)
// =============================================================================

// Must be set before importing event.consumer.js
process.env.WORKER_PROCESS = 'true';

import { startEmergencyWorker, stopEmergencyWorker } from './emergency.worker.js';
import { startNotificationWorker, stopNotificationWorker } from './notification.worker.js';
import { startScanWorker, stopScanWorker } from './scan.worker.js';
import { startMaintenanceWorker, stopMaintenanceWorker } from './maintenance.worker.js';
import { closeAllQueues } from '../queues/queue.config.js';
import { closeQueueConnection } from '../queues/queue.connection.js';
import { flushDlqSlackBatch } from '../dlq/dlq.handler.js';
import { logger } from '#config/logger.js';

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  white: '\x1b[97m',
  gray: '\x1b[90m',
  orange: '\x1b[38;5;208m',
  mint: '\x1b[38;5;121m',
  coral: '\x1b[38;5;203m',
  sky: '\x1b[38;5;117m',
  amber: '\x1b[38;5;214m',
  lime: '\x1b[38;5;154m',
};

const ok = `${c.green}${c.bold}✓${c.reset}`;
const fail = `${c.red}${c.bold}✗${c.reset}`;
const pad = (s, n) => String(s).padEnd(n);

const ROLE = (process.env.WORKER_ROLE ?? 'all').toLowerCase();

// =============================================================================
// WORKER REGISTRY
// =============================================================================

const ALL_WORKERS = [
  {
    name: 'EmergencyWorker',
    queue: 'emergency_queue',
    conc: 10,
    roles: ['all', 'emergency'],
    col: c.coral,
    desc: 'QR scan events · parent alerts · sacred pipeline',
    start: startEmergencyWorker,
    stop: stopEmergencyWorker,
  },
  {
    name: 'NotificationWorker',
    queue: 'notification_queue',
    conc: 5,
    roles: ['all', 'notification'],
    col: c.sky,
    desc: 'Email · SMS · Push dispatch',
    start: startNotificationWorker,
    stop: stopNotificationWorker,
  },
  {
    name: 'ScanWorker',
    queue: 'setInterval/60s',
    conc: 1,
    roles: ['all', 'emergency'],
    col: c.mint,
    desc: 'Drain Redis scan logs → Postgres bulk insert',
    start: startScanWorker,
    stop: stopScanWorker,
  },
  {
    name: 'MaintenanceWorker',
    queue: 'setInterval/24h',
    conc: 1,
    roles: ['all'],
    col: c.amber,
    desc: 'Token expiry · stalled pipelines · DB cleanup',
    start: startMaintenanceWorker,
    stop: stopMaintenanceWorker,
  },
];

const LOCAL_WORKERS = [
  {
    name: 'PipelineWorker',
    queue: 'pipeline_queue',
    conc: 3,
    col: c.orange,
    desc: 'Token generation · order pipeline (local until 50 schools)',
    script: 'npm run worker:pipeline',
  },
  {
    name: 'DesignWorker',
    queue: 'pipeline_queue',
    conc: 1,
    col: c.lime,
    desc: 'Card PDF generation · QR PNG stamping (on-demand only)',
    script: 'npm run worker:design',
  },
];

const ACTIVE = ALL_WORKERS.filter(w => w.roles.includes(ROLE));
const startedWorkers = [];

// =============================================================================
// BANNER + INFO
// =============================================================================

function printBanner() {
  const W = 64;
  const hl = c.amber;
  const box = { tl: '╔', tr: '╗', bl: '╚', br: '╝', h: '═', v: '║', ml: '╠', mr: '╣' };
  const row = (text = '') => {
    const visible = text.replace(/\x1b\[[0-9;]*m/g, '');
    const p = W - visible.length;
    return `${hl}${box.v}${c.reset}${text}${' '.repeat(Math.max(0, p))}${hl}${box.v}${c.reset}`;
  };
  const divider = `${hl}${box.ml}${box.h.repeat(W)}${box.mr}${c.reset}`;

  console.log('');
  console.log(`${hl}${box.tl}${box.h.repeat(W)}${box.tr}${c.reset}`);
  console.log(row());
  console.log(
    row(`  ${c.bold}${c.white}⚙  RESQID${c.reset}${c.dim}  by coreZ Technologies Pvt. Ltd.`)
  );
  console.log(row(`  ${c.dim}QR-based Student Emergency Identity System`));
  console.log(row());
  console.log(divider);
  console.log(row());
  console.log(
    row(
      `  ${c.amber}${c.bold}WORKER PROCESS${c.reset}  ${c.gray}·${c.reset}  ${c.dim}BullMQ  ·  Upstash Redis  ·  PostgreSQL${c.reset}`
    )
  );
  console.log(
    row(
      `  ${c.dim}WORKER_ROLE=${c.reset}${c.amber}${c.bold}${ROLE.toUpperCase()}${c.reset}  ${c.gray}·${c.reset}  ${c.dim}${ACTIVE.length} worker${ACTIVE.length !== 1 ? 's' : ''} in this process${c.reset}`
    )
  );
  console.log(row());
  console.log(`${hl}${box.bl}${box.h.repeat(W)}${box.br}${c.reset}`);
  console.log('');
}

function printTopology() {
  const W = 72;
  const SEP = `  ${c.gray}${'─'.repeat(W)}${c.reset}`;

  console.log(`\n${SEP}`);
  console.log(
    `  ${c.bold}${c.cyan}Worker Topology${c.reset}  ${c.dim}Railway (always on) vs Local (on demand)${c.reset}`
  );
  console.log(SEP);
  console.log(
    `  ${c.dim}${'Worker'.padEnd(24)} ${'Type'.padEnd(16)} ${'Queue / Interval'.padEnd(22)} Conc${c.reset}`
  );
  console.log(SEP);

  ALL_WORKERS.forEach(w => {
    const isActive = ACTIVE.some(a => a.name === w.name);
    const dot = isActive ? `${w.col}●${c.reset}` : `${c.gray}○${c.reset}`;
    const name = isActive
      ? `${w.col}${c.bold}${pad(w.name, 22)}${c.reset}`
      : `${c.gray}${pad(w.name, 22)}${c.reset}`;
    console.log(
      `  ${dot}  ${name}${c.sky}${pad('Railway', 16)}${c.reset}${c.dim}${pad(w.queue, 22)}${c.reset}${c.gray}×${w.conc}${c.reset}`
    );
  });

  console.log(SEP);

  LOCAL_WORKERS.forEach(w => {
    console.log(
      `  ${c.gray}○  ${pad(w.name, 22)}${c.orange}${pad('Local only', 16)}${c.reset}${c.dim}${pad(w.queue, 22)}${c.reset}${c.gray}×${w.conc}${c.reset}`
    );
  });

  console.log(SEP);
  console.log(`\n  ${c.dim}Local workers: run manually when needed, Ctrl+C when done${c.reset}`);
  LOCAL_WORKERS.forEach(w => {
    console.log(`  ${c.gray}→  ${w.script}${c.reset}  ${c.dim}${w.desc}${c.reset}`);
  });
  console.log(SEP);
}

// =============================================================================
// DLQ SLACK BATCH FLUSH — hourly
// =============================================================================

let _dlqFlushInterval = null;

const startDlqFlush = () => {
  _dlqFlushInterval = setInterval(
    async () => {
      try {
        await flushDlqSlackBatch();
      } catch (err) {
        logger.error({ err: err.message }, '[workers/index] DLQ batch flush failed');
      }
    },
    60 * 60 * 1000
  ); // every hour
  if (_dlqFlushInterval.unref) _dlqFlushInterval.unref();
  logger.info('[workers/index] DLQ Slack batch flush started (hourly)');
};

const stopDlqFlush = () => {
  if (_dlqFlushInterval) {
    clearInterval(_dlqFlushInterval);
    _dlqFlushInterval = null;
  }
};

// =============================================================================
// GRACEFUL SHUTDOWN
// =============================================================================

const gracefulShutdown = async signal => {
  console.log(`\n  ${c.gold}⚡ ${signal} — draining workers…${c.reset}`);
  logger.info({ signal }, '[workers/index] Graceful shutdown');

  stopDlqFlush();

  try {
    await Promise.allSettled([
      stopEmergencyWorker(),
      stopNotificationWorker(),
      stopScanWorker(),
      stopMaintenanceWorker(),
    ]);

    await closeAllQueues();
    await closeQueueConnection();

    console.log(
      `\n  ${ok}  ${c.bold}${c.green}All workers drained — shutdown complete${c.reset}\n`
    );
    logger.info('[workers/index] All workers closed — exiting');
    process.exit(0);
  } catch (err) {
    logger.error({ err: err.message }, '[workers/index] Shutdown error');
    process.exit(1);
  }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('uncaughtException', err => {
  logger.fatal({ err }, 'Uncaught exception in worker process');
  process.exit(1);
});

process.on('unhandledRejection', reason => {
  logger.fatal({ reason }, 'Unhandled rejection in worker process');
  process.exit(1);
});

// =============================================================================
// START
// =============================================================================

export const startWorkers = () => {
  printBanner();
  printTopology();

  if (ACTIVE.length === 0) {
    console.error(`\n  ${fail}  ${c.red}Unknown WORKER_ROLE="${ROLE}"${c.reset}`);
    console.error(`  ${c.dim}Valid roles: all · emergency · notification${c.reset}\n`);
    process.exit(1);
  }

  logger.info({ role: ROLE, count: ACTIVE.length }, '[workers/index] Starting workers');

  ACTIVE.forEach(w => startedWorkers.push(w.start()));
  startDlqFlush();

  logger.info({ role: ROLE, workers: ACTIVE.map(w => w.name) }, '[workers/index] Workers started');
  console.log(
    `\n  ${ok}  ${c.bold}${c.green}${ACTIVE.length} worker${ACTIVE.length !== 1 ? 's' : ''} running${c.reset}  ${c.dim}Waiting for jobs…${c.reset}\n`
  );
};

// Auto-start when executed directly
import { fileURLToPath } from 'url';
import { resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const entrypoint = resolve(process.argv[1]);

if (resolve(__filename) === entrypoint) {
  startWorkers();
}
