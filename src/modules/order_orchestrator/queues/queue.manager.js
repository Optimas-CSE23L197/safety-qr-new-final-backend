// =============================================================================
// queues/queue.manager.js
// Centralised queue registry — all queues are created once and reused.
// Workers and publishers import queues through here only.
// =============================================================================

import { Queue } from "bullmq";
import { workerRedis } from "../../../config/redis.js";
import { logger } from "../../../config/logger.js";
import { QUEUE_NAMES } from "../orchestrator.constants.js";

// Shared BullMQ connection config — uses the existing ioredis instance
const CONNECTION = { client: workerRedis };

// In-memory registry — created once per process lifecycle
const _queues = new Map();

/**
 * Get (or create) a named queue.
 * @param {string} name - one of QUEUE_NAMES
 * @returns {Queue}
 */
export function getQueue(name) {
  if (_queues.has(name)) return _queues.get(name);

  const queue = new Queue(name, {
    connection: CONNECTION,
    defaultJobOptions: {
      removeOnComplete: { count: 100 },
      removeOnFail: false,
    },
  });

  queue.on("error", (err) => {
    logger.error({ msg: "Queue error", queue: name, err: err.message });
  });

  _queues.set(name, queue);
  logger.info({ msg: "Queue initialised", queue: name });

  return queue;
}

/**
 * Initialise all queues at startup.
 * Call this once in app.js / server.js before workers start.
 */
export function initQueues() {
  for (const name of Object.values(QUEUE_NAMES)) {
    getQueue(name);
  }
  logger.info({
    msg: "All orchestrator queues initialised",
    count: _queues.size,
  });
}

/**
 * Gracefully close all queues (for clean shutdown).
 */
export async function closeQueues() {
  const closeTasks = [..._queues.values()].map((q) => q.close());
  await Promise.allSettled(closeTasks);
  _queues.clear();
  logger.info({ msg: "All orchestrator queues closed" });
}

/**
 * Get queue health metrics (job counts per queue).
 * Used by the health check endpoint.
 */
export async function getQueueHealth() {
  const health = {};

  for (const [name, queue] of _queues.entries()) {
    const counts = await queue.getJobCounts(
      "waiting",
      "active",
      "failed",
      "delayed",
    );
    health[name] = counts;
  }

  return health;
}
