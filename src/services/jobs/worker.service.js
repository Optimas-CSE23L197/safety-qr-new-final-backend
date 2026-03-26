// =============================================================================
// src/services/jobs/worker.service.js
// Entry point for running BullMQ workers
// =============================================================================

import { logger } from "../../config/logger.js";
import { tokenGenerationWorker } from "./tokenGenerationWorker.js";

// Start the worker
logger.info("🚀 Starting BullMQ worker service...");

tokenGenerationWorker.on("ready", () => {
  logger.info("✅ Token generation worker is ready");
});

tokenGenerationWorker.on("error", (err) => {
  logger.error({ err: err.message }, "Worker error");
});

tokenGenerationWorker.on("failed", (job, err) => {
  logger.error({ jobId: job?.id, err: err.message }, "Job failed");
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  logger.info("SIGTERM received, closing worker...");
  await tokenGenerationWorker.close();
  process.exit(0);
});

process.on("SIGINT", async () => {
  logger.info("SIGINT received, closing worker...");
  await tokenGenerationWorker.close();
  process.exit(0);
});

logger.info("✅ Worker service started, waiting for jobs...");
