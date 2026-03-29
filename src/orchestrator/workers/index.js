// =============================================================================
// orchestrator/workers/index.js — RESQID PHASE 1
// Starts workers based on WORKER_ROLE environment variable.
//
// WORKER_ROLE=emergency    → emergency worker only
// WORKER_ROLE=notification → notification worker only
// WORKER_ROLE=background   → invoice + maintenance workers
// WORKER_ROLE=all          → all 4 workers (local dev)
// =============================================================================

import { startEmergencyWorker, stopEmergencyWorker } from './emergency.worker.js';
import { startNotificationWorker, stopNotificationWorker } from './notification.worker.js';
import { startInvoiceWorker, stopInvoiceWorker } from './invoice.worker.js';
import { startMaintenanceWorker, stopMaintenanceWorker } from './maintenance.worker.js';
import { closeAllQueues } from '../queues/queue.config.js';
import { closeQueueConnection } from '../queues/queue.connection.js';
import { logger } from '#config/logger.js';

const ROLE = (process.env.WORKER_ROLE ?? 'all').toLowerCase();

const startedWorkers = [];

export const startWorkers = () => {
  logger.info({ role: ROLE }, '[workers/index] Starting Phase 1 workers');

  switch (ROLE) {
    case 'emergency':
      startedWorkers.push(startEmergencyWorker());
      break;

    case 'notification':
      startedWorkers.push(startNotificationWorker());
      break;

    case 'background':
      startedWorkers.push(startInvoiceWorker(), startMaintenanceWorker());
      break;

    case 'all':
      startedWorkers.push(
        startEmergencyWorker(),
        startNotificationWorker(),
        startInvoiceWorker(),
        startMaintenanceWorker()
      );
      break;

    default:
      logger.warn({ role: ROLE }, '[workers/index] Unknown WORKER_ROLE — defaulting to all');
      startedWorkers.push(
        startEmergencyWorker(),
        startNotificationWorker(),
        startInvoiceWorker(),
        startMaintenanceWorker()
      );
  }

  logger.info({ role: ROLE, count: startedWorkers.length }, '[workers/index] Workers started');
};

const gracefulShutdown = async signal => {
  logger.info({ signal }, '[workers/index] Graceful shutdown initiated');

  try {
    await Promise.allSettled([
      stopEmergencyWorker(),
      stopNotificationWorker(),
      stopInvoiceWorker(),
      stopMaintenanceWorker(),
    ]);

    await closeAllQueues();
    await closeQueueConnection();

    logger.info('[workers/index] All workers closed — exiting');
    process.exit(0);
  } catch (err) {
    logger.error({ err: err.message }, '[workers/index] Error during shutdown');
    process.exit(1);
  }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

if (process.argv[1]?.endsWith('workers/index.js')) {
  startWorkers();
}
