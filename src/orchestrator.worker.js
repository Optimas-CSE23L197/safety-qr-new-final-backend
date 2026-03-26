import { initQueues } from "./modules/order_orchestrator/queues/queue.manager.js";
import { startAllWorkers } from "./modules/order_orchestrator/workers/index.js";
import { logger } from "./config/logger.js";

async function startWorkers() {
  try {
    console.log("🚀 Starting Orchestrator Worker Process...");
    logger.info("🚀 Starting Orchestrator Worker Process...");

    // Initialize queues
    console.log("📦 Initializing queues...");
    initQueues();
    console.log("✅ Queues initialized");

    // Start all workers
    console.log("👷 Starting workers...");
    await startAllWorkers();
    console.log("✅ All workers started");
    logger.info("✅ All workers started");

    // Keep process alive
    console.log("🟢 Workers running. Press Ctrl+C to stop.");
  } catch (err) {
    console.error("❌ Worker startup failed:", err.message);
    logger.error({ error: err.message }, "❌ Worker startup failed");
    process.exit(1);
  }
}

startWorkers();
