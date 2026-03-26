// =============================================================================
// workers/index.js — RESQID (UPDATED with notification worker)
// =============================================================================

import { logger } from "../../../config/logger.js";
import { createTokenWorker } from "./token.worker.js";
import { createDesignWorker } from "./design.worker.js";
import { createCancelWorker } from "./cancel.worker.js";
import { createFailureWorker } from "./failure.worker.js";
import { createInvoiceNotificationWorker } from "./invoice_notification.worker.js";
import { createNotificationWorker } from "../notifications/notification.dispatcher.js"; // ✅ ADDED

const _workers = new Map();

export async function startAllWorkers() {
  logger.info({ msg: "Starting orchestrator workers" });

  const workerCreators = [
    { name: "token", creator: createTokenWorker },
    { name: "design", creator: createDesignWorker },
    { name: "cancel", creator: createCancelWorker },
    { name: "failure", creator: createFailureWorker },
    { name: "invoice-notification", creator: createInvoiceNotificationWorker },
    { name: "notification", creator: createNotificationWorker }, // ✅ ADDED
  ];

  for (const { name, creator } of workerCreators) {
    try {
      const worker = creator();
      _workers.set(name, worker);
      logger.info({ msg: "Worker started", name });
    } catch (error) {
      logger.error({
        msg: "Failed to start worker — skipping",
        name,
        error: error.message,
      });
    }
  }

  logger.info({
    msg: "Orchestrator workers started",
    count: _workers.size,
    workers: [..._workers.keys()],
  });

  return _workers;
}

export async function stopAllWorkers() {
  logger.info({ msg: "Stopping orchestrator workers" });

  const closePromises = [];
  for (const [name, worker] of _workers.entries()) {
    closePromises.push(
      worker
        .close()
        .then(() => logger.info({ msg: "Worker closed", name }))
        .catch((err) =>
          logger.error({
            msg: "Error closing worker",
            name,
            error: err.message,
          }),
        ),
    );
  }

  await Promise.allSettled(closePromises);
  _workers.clear();
  logger.info({ msg: "All orchestrator workers stopped" });
}

export function getWorker(name) {
  return _workers.get(name);
}

export function getAllWorkers() {
  return new Map(_workers);
}
