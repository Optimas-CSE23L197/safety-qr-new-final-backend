// =============================================================================
// orchestrator/workers/index.js — RESQID PHASE 1
// ─────────────────────────────────────────────
// coreZ Technologies Pvt. Ltd.
//
// Run via npm scripts:
//   npm run worker:easy           → WORKER_ROLE=all   (local dev — all 6 workers)
//   npm run worker:emergency      → WORKER_ROLE=emergency
//   npm run worker:notification   → WORKER_ROLE=notification
//   npm run worker:background     → WORKER_ROLE=background  (invoice + maintenance)
//   npm run worker:pipeline       → standalone pipeline worker
//   npm run worker:design         → standalone design worker
//
// Railway:  deploy TWO services — one server, one worker (WORKER_ROLE=emergency or notification or background)
// Local:    WORKER_ROLE=all starts all 6 workers in one process
// =============================================================================

import { startEmergencyWorker, stopEmergencyWorker } from './emergency.worker.js';
import { startNotificationWorker, stopNotificationWorker } from './notification.worker.js';
import { startInvoiceWorker, stopInvoiceWorker } from './invoice.worker.js';
import { startMaintenanceWorker, stopMaintenanceWorker } from './maintenance.worker.js';
import { closeAllQueues } from '../queues/queue.config.js';
import { closeQueueConnection } from '../queues/queue.connection.js';
import { logger } from '#config/logger.js';
import os from 'os';

// ── ANSI palette (same DNA as server.js) ──────────────────────────────────
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
  magenta: '\x1b[35m',

  // Extended
  orange: '\x1b[38;5;208m',
  violet: '\x1b[38;5;141m',
  mint: '\x1b[38;5;121m',
  coral: '\x1b[38;5;203m',
  gold: '\x1b[38;5;220m',
  sky: '\x1b[38;5;117m',
  amber: '\x1b[38;5;214m',
  lime: '\x1b[38;5;154m',
};

const ok = `${c.green}${c.bold}✓${c.reset}`;
const fail = `${c.red}${c.bold}✗${c.reset}`;
const warn = `${c.gold}${c.bold}⚠${c.reset}`;
const pad = (s, n) => String(s).padEnd(n);

// ── Role resolution ────────────────────────────────────────────────────────
const ROLE = (process.env.WORKER_ROLE ?? 'all').toLowerCase();

// ── Worker registry — truth table for Phase 1 ─────────────────────────────
//
//  deploy:   Railway → 4 workers  (emergency + notification + invoice + maintenance)
//  local:    all 6   (add pipeline + design which need local disk access for pdf-lib / QR)
//
const ALL_WORKERS = [
  {
    name: 'EmergencyWorker',
    queue: 'EMERGENCY_ALERTS',
    conc: 20,
    roles: ['all', 'emergency'],
    deploy: 'railway',
    col: c.coral,
    desc: 'QR scan events · anomaly detection · parent alerts',
    start: startEmergencyWorker,
    stop: stopEmergencyWorker,
  },
  {
    name: 'NotificationWorker',
    queue: 'NOTIFICATIONS',
    conc: 10,
    roles: ['all', 'notification'],
    deploy: 'railway',
    col: c.sky,
    desc: 'Email · SMS · Push dispatch',
    start: startNotificationWorker,
    stop: stopNotificationWorker,
  },
  {
    name: 'InvoiceWorker',
    queue: 'BACKGROUND_JOBS',
    conc: 5,
    roles: ['all', 'background'],
    deploy: 'railway',
    col: c.violet,
    desc: 'Invoice generation + notification',
    start: startInvoiceWorker,
    stop: stopInvoiceWorker,
  },
  {
    name: 'MaintenanceWorker',
    queue: 'BACKGROUND_JOBS',
    conc: 2,
    roles: ['all', 'background'],
    deploy: 'railway',
    col: c.amber,
    desc: 'DB cleanup · token expiry · scheduled jobs',
    start: startMaintenanceWorker,
    stop: stopMaintenanceWorker,
  },
];

// Pipeline + Design are standalone scripts (see npm run worker:pipeline/design)
// They're shown in the topology table but NOT started here.
const STANDALONE_WORKERS = [
  {
    name: 'PipelineWorker',
    queue: 'BACKGROUND_JOBS',
    conc: 2,
    deploy: 'local',
    col: c.orange,
    desc: 'Order pipeline orchestration (local disk)',
    script: 'npm run worker:pipeline',
  },
  {
    name: 'DesignWorker',
    queue: 'BACKGROUND_JOBS',
    conc: 1,
    deploy: 'local',
    col: c.lime,
    desc: 'Card PDF / QR PNG generation (pdf-lib)',
    script: 'npm run worker:design',
  },
];

// Active set for this process
const ACTIVE = ALL_WORKERS.filter(w => w.roles.includes(ROLE));

const startedWorkers = [];

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

  const hl = c.amber;
  const blank = ' '.repeat(W);

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
      `  ${c.amber}${c.bold}WORKER PROCESS${c.reset}` +
        `  ${c.gray}·${c.reset}  ` +
        `${c.dim}BullMQ  ·  Upstash Redis  ·  PostgreSQL${c.reset}`
    )
  );
  console.log(
    row(
      `  ${c.dim}WORKER_ROLE=${c.reset}${c.amber}${c.bold}${ROLE.toUpperCase()}${c.reset}` +
        `  ${c.gray}·${c.reset}  ${c.dim}${ACTIVE.length} worker${ACTIVE.length !== 1 ? 's' : ''} in this process${c.reset}`
    )
  );
  console.log(row());
  console.log(`${hl}${box.bl}${box.h.repeat(W)}${box.br}${c.reset}`);
  console.log('');
}

// ══════════════════════════════════════════════════════════════════════════
// PROCESS INFO TABLE
// ══════════════════════════════════════════════════════════════════════════
function printWorkerInfo() {
  const env = process.env.NODE_ENV ?? 'development';
  const envCol =
    {
      production: c.coral,
      staging: c.gold,
      development: c.mint,
      test: c.sky,
    }[env] ?? c.white;

  const W = 56;
  const SEP = `  ${c.gray}${'─'.repeat(W)}${c.reset}`;

  const rows = [
    ['Role', `${c.amber}${c.bold}Worker Process${c.reset}  ${c.gray}PID ${process.pid}${c.reset}`],
    ['WORKER_ROLE', `${c.amber}${c.bold}${ROLE.toUpperCase()}${c.reset}`],
    [
      'Workers',
      `${c.green}${c.bold}${ACTIVE.length} active${c.reset}  ${c.gray}/ ${ALL_WORKERS.length + STANDALONE_WORKERS.length} total${c.reset}`,
    ],
    ['Environment', `${envCol}${c.bold}${env.toUpperCase()}${c.reset}`],
    ['Node', `${c.dim}${process.version}${c.reset}`],
    ['CPUs', `${c.dim}${os.cpus().length} cores${c.reset}`],
    ['Memory', `${c.dim}${Math.round(os.totalmem() / 1024 / 1024)} MB${c.reset}`],
    ['Host', `${c.dim}${os.hostname()}${c.reset}`],
    ['Started', `${c.dim}${new Date().toISOString()}${c.reset}`],
  ];

  console.log(SEP);
  console.log(`  ${c.bold}${c.amber}Worker Process${c.reset}`);
  console.log(SEP);

  rows.forEach(([key, val]) => {
    console.log(`  ${c.dim}${pad(key, 14)}${c.reset}${val}`);
  });

  console.log(SEP);
}

// ══════════════════════════════════════════════════════════════════════════
// ACTIVE WORKER TABLE
// ══════════════════════════════════════════════════════════════════════════
function printActiveWorkers() {
  const W = 68;
  const SEP = `  ${c.gray}${'─'.repeat(W)}${c.reset}`;

  console.log(`\n${SEP}`);
  console.log(
    `  ${c.bold}${c.amber}Active Workers${c.reset}` +
      `  ${c.dim}WORKER_ROLE=${c.reset}${c.amber}${c.bold}${ROLE}${c.reset}`
  );
  console.log(SEP);
  console.log(
    `  ${c.dim}${'Worker'.padEnd(24)} ${'Queue'.padEnd(22)} ${'Conc'.padEnd(6)} Description${c.reset}`
  );
  console.log(SEP);

  ACTIVE.forEach(({ name, queue, conc, col, desc }) => {
    const dot = `${col}●${c.reset}`;
    console.log(
      `  ${dot}  ${col}${c.bold}${pad(name, 22)}${c.reset}` +
        `${c.sky}${pad(queue, 22)}${c.reset}` +
        `${c.gray}×${pad(conc, 5)}${c.reset}` +
        `${c.dim}${desc}${c.reset}`
    );
  });

  if (ACTIVE.length === 0) {
    console.log(`  ${warn}  ${c.gold}No workers matched role "${ROLE}"${c.reset}`);
  }

  console.log(SEP);
}

// ══════════════════════════════════════════════════════════════════════════
// FULL PHASE 1 TOPOLOGY  (all 6 workers, showing what runs where)
// ══════════════════════════════════════════════════════════════════════════
function printTopology() {
  const W = 68;
  const SEP = `  ${c.gray}${'─'.repeat(W)}${c.reset}`;

  const locationLabel = (deploy, isActive) => {
    if (deploy === 'railway') {
      return isActive ? `${c.violet}${c.bold}☁ Railway${c.reset}` : `${c.gray}☁ Railway${c.reset}`;
    }
    return isActive ? `${c.orange}${c.bold}⚙ Local${c.reset}` : `${c.gray}⚙ Local${c.reset}`;
  };

  const allSix = [...ALL_WORKERS, ...STANDALONE_WORKERS];

  console.log(`\n${SEP}`);
  console.log(
    `  ${c.bold}${c.cyan}Phase 1 Topology${c.reset}  ${c.dim}6 workers across 3 queues${c.reset}`
  );
  console.log(SEP);
  console.log(
    `  ${c.dim}${'Worker'.padEnd(24)} ${'Location'.padEnd(14)} ${'Queue'.padEnd(22)} Conc${c.reset}`
  );
  console.log(SEP);

  allSix.forEach(w => {
    const isActive = ACTIVE.some(a => a.name === w.name);
    const status = isActive ? `${w.col}●${c.reset}` : `${c.gray}○${c.reset}`;
    const nameFmt = isActive
      ? `${w.col}${c.bold}${pad(w.name, 22)}${c.reset}`
      : `${c.gray}${pad(w.name, 22)}${c.reset}`;
    const location = locationLabel(w.deploy, isActive);
    const queue = isActive
      ? `${c.sky}${pad(w.queue, 22)}${c.reset}`
      : `${c.gray}${pad(w.queue, 22)}${c.reset}`;
    const conc = isActive ? `${c.gray}×${w.conc}${c.reset}` : `${c.gray}×${w.conc}${c.reset}`;

    console.log(
      `  ${status}  ${nameFmt}${pad(location.replace(/\x1b\[[0-9;]*m/g, ''), 14) === pad(location.replace(/\x1b\[[0-9;]*m/g, ''), 14) ? location + ' '.repeat(Math.max(0, 14 - location.replace(/\x1b\[[0-9;]*m/g, '').length)) : location}${queue}${conc}`
    );
  });

  console.log(SEP);

  // Queue summary
  const queues = [
    { name: 'EMERGENCY_ALERTS', col: c.coral, workers: ['EmergencyWorker'] },
    { name: 'NOTIFICATIONS', col: c.sky, workers: ['NotificationWorker'] },
    {
      name: 'BACKGROUND_JOBS',
      col: c.violet,
      workers: ['InvoiceWorker', 'MaintenanceWorker', 'PipelineWorker', 'DesignWorker'],
    },
  ];

  console.log(
    `\n  ${c.bold}${c.cyan}Queue Map${c.reset}  ${c.dim}3 queues (Upstash free tier safe)${c.reset}`
  );
  queues.forEach(({ name, col, workers }) => {
    console.log(
      `  ${col}${c.bold}${pad(name, 22)}${c.reset}` + `${c.dim}→ ${workers.join(', ')}${c.reset}`
    );
  });

  console.log(SEP);
}

// ══════════════════════════════════════════════════════════════════════════
// RUNTIME STATS (dev only — printed every 60s)
// ══════════════════════════════════════════════════════════════════════════
function startStatsPrinter() {
  if ((process.env.NODE_ENV ?? 'development') === 'production') return;

  setInterval(() => {
    const mem = process.memoryUsage();
    const rss = Math.round(mem.rss / 1024 / 1024);
    const heap = Math.round(mem.heapUsed / 1024 / 1024);
    const ext = Math.round(mem.external / 1024 / 1024);
    const upMs = process.uptime() * 1000;
    const upStr =
      upMs > 3_600_000
        ? `${Math.floor(upMs / 3_600_000)}h`
        : upMs > 60_000
          ? `${Math.floor(upMs / 60_000)}m`
          : `${Math.floor(upMs / 1000)}s`;

    console.log(
      `\n  ${c.dim}[${new Date().toISOString()}]${c.reset}` +
        `  ${c.amber}RSS${c.reset} ${rss}MB` +
        `  ${c.amber}Heap${c.reset} ${heap}MB` +
        `  ${c.amber}Ext${c.reset} ${ext}MB` +
        `  ${c.green}Workers${c.reset} ${startedWorkers.length} active` +
        `  ${c.dim}Up ${upStr}${c.reset}`
    );
  }, 60_000);
}

// ══════════════════════════════════════════════════════════════════════════
// GRACEFUL SHUTDOWN
// ══════════════════════════════════════════════════════════════════════════
const gracefulShutdown = async signal => {
  console.log(`\n  ${c.gold}⚡ ${signal} received — draining workers…${c.reset}`);
  logger.info({ signal }, '[workers/index] Graceful shutdown initiated');

  const step = label => console.log(`  ${c.yellow}›${c.reset} ${c.dim}${label}${c.reset}`);

  try {
    step('Stopping all workers (BullMQ drains in-flight jobs)…');
    await Promise.allSettled([
      stopEmergencyWorker(),
      stopNotificationWorker(),
      stopInvoiceWorker(),
      stopMaintenanceWorker(),
    ]);

    step('Closing queues…');
    await closeAllQueues();

    step('Closing queue connection…');
    await closeQueueConnection();

    console.log(
      `\n  ${ok}  ${c.bold}${c.green}All workers drained — shutdown complete${c.reset}\n`
    );
    logger.info('[workers/index] All workers closed — exiting');
    process.exit(0);
  } catch (err) {
    logger.error({ err: err.message }, '[workers/index] Error during shutdown');
    console.error(`\n  ${fail}  ${c.red}Shutdown error: ${err.message}${c.reset}`);
    process.exit(1);
  }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('uncaughtException', err => {
  logger.fatal({ err }, 'Uncaught exception in worker process');
  console.error(`\n  ${fail}  ${c.red}Uncaught Exception: ${err.message}${c.reset}`);
  console.error(err.stack);
  process.exit(1);
});

process.on('unhandledRejection', reason => {
  logger.fatal({ reason }, 'Unhandled rejection in worker process');
  console.error(`\n  ${fail}  ${c.red}Unhandled Rejection: ${reason}${c.reset}`);
  process.exit(1);
});

// ══════════════════════════════════════════════════════════════════════════
// START
// ══════════════════════════════════════════════════════════════════════════
export const startWorkers = () => {
  printBanner();
  printWorkerInfo();
  printTopology();

  logger.info({ role: ROLE, count: ACTIVE.length }, '[workers/index] Starting Phase 1 workers');

  if (ACTIVE.length === 0) {
    console.error(
      `\n  ${fail}  ${c.red}Unknown WORKER_ROLE="${ROLE}" — nothing to start${c.reset}`
    );
    console.error(`  ${c.dim}Valid roles: all · emergency · notification · background${c.reset}\n`);
    process.exit(1);
  }

  ACTIVE.forEach(w => {
    startedWorkers.push(w.start());
  });

  printActiveWorkers();
  startStatsPrinter();

  logger.info({ role: ROLE, workers: ACTIVE.map(w => w.name) }, '[workers/index] Workers started');

  console.log(
    `\n  ${ok}  ${c.bold}${c.green}${ACTIVE.length} worker${ACTIVE.length !== 1 ? 's' : ''} running${c.reset}  ${c.dim}Waiting for jobs…${c.reset}\n`
  );
};

// ── Auto-start when executed directly ─────────────────────────────────────
// Use import.meta.url instead of process.argv[1] string matching — works
// correctly on Windows (backslash paths) and any shell invocation style.
import { fileURLToPath } from 'url';
import { resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const entrypoint = resolve(process.argv[1]);

if (resolve(__filename) === entrypoint) {
  startWorkers();
}
