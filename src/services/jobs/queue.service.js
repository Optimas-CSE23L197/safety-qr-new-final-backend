// =============================================================================
// queue.service.js — RESQID
// Central BullMQ queue registry. All queues defined here.
// Producers call enqueue* helpers. Workers import queues directly.
//
// Queue names are stable string constants — never hardcode them anywhere else.
// =============================================================================

import { Queue, QueueEvents } from "bullmq";
import Redis from "ioredis";
import { logger } from "../../config/logger.js";
import { prisma } from "../../config/prisma.js";
import * as pipelineRepo from "../../modules/order/pipeline/pipeline.repository.js";

// ─────────────────────────────────────────────────────────────────────────────
// DEDICATED REDIS CONNECTION FOR BULLMQ (NO KEY PREFIX)
// BullMQ does NOT support ioredis with keyPrefix configured.
// Create a separate connection without keyPrefix for all queue operations.
// ─────────────────────────────────────────────────────────────────────────────

// Get Redis URL from environment
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

// Create dedicated connection for BullMQ
const bullRedisConnection = new Redis(REDIS_URL, {
  // BullMQ requires these settings
  maxRetriesPerRequest: null,
  enableReadyCheck: false,

  // Connection settings
  connectTimeout: parseInt(process.env.REDIS_CONNECT_TIMEOUT) || 10000,
  commandTimeout: parseInt(process.env.REDIS_COMMAND_TIMEOUT) || 5000,
  keepAlive: parseInt(process.env.REDIS_KEEP_ALIVE) || 30000,

  // Reconnect strategy — exponential backoff
  retryStrategy: (times) => {
    if (times > 20) {
      logger.fatal(
        { type: "bullmq_redis_reconnect_failed", attempts: times },
        "BullMQ Redis: gave up reconnecting after 20 attempts",
      );
      return null;
    }
    const delay = Math.min(100 * Math.pow(2, times), 30000);
    logger.warn(
      { type: "bullmq_redis_reconnecting", attempt: times, nextRetryMs: delay },
      `BullMQ Redis: reconnecting in ${delay}ms (attempt ${times})`,
    );
    return delay;
  },

  // Reconnect on specific errors
  reconnectOnError: (err) => {
    const targetErrors = ["READONLY", "ECONNRESET", "ECONNREFUSED"];
    if (targetErrors.some((e) => err.message.includes(e))) {
      return 2;
    }
    return false;
  },

  // Enable offline queue — commands issued during reconnect are queued
  enableOfflineQueue: true,
  autoResubscribe: true,
  autoResendUnfulfilledCommands: true,

  // IMPORTANT: NO keyPrefix here — BullMQ manages its own key namespacing
  // IMPORTANT: Password is handled via REDIS_URL if included
});

// Add connection event handlers for monitoring
bullRedisConnection.on("connect", () => {
  logger.info({ type: "bullmq_redis_connect" }, "BullMQ Redis: connected");
});

bullRedisConnection.on("ready", () => {
  logger.info({ type: "bullmq_redis_ready" }, "BullMQ Redis: ready");
});

bullRedisConnection.on("error", (err) => {
  logger.error(
    { type: "bullmq_redis_error", err: err.message },
    `BullMQ Redis: error — ${err.message}`,
  );
});

bullRedisConnection.on("close", () => {
  logger.warn(
    { type: "bullmq_redis_close" },
    "BullMQ Redis: connection closed",
  );
});

bullRedisConnection.on("reconnecting", (delay) => {
  logger.warn(
    { type: "bullmq_redis_reconnecting", delay },
    `BullMQ Redis: reconnecting in ${delay}ms`,
  );
});

bullRedisConnection.on("end", () => {
  logger.warn(
    { type: "bullmq_redis_end" },
    "BullMQ Redis: connection permanently closed",
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// QUEUE REGISTRY
// ─────────────────────────────────────────────────────────────────────────────

const QUEUE_NAMES = {
  TOKEN_GENERATION: "token-generation",
  CARD_DESIGN: "card-design",
  PIPELINE_STEP: "pipeline-step", // lightweight steps (vendor, shipment, etc.)
};

const defaultJobOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 5000 },
  removeOnComplete: { count: 200 }, // keep last 200 completed jobs in Redis
  removeOnFail: false, // keep failed jobs until manually cleared
};

// Create queues with dedicated BullMQ Redis connection
const createQueue = (name) =>
  new Queue(name, {
    connection: bullRedisConnection,
    defaultJobOptions,
    // Optional: BullMQ's own prefix (separate from ioredis keyPrefix)
    // Uncomment if you want to namespace all BullMQ keys
    // prefix: "bull",
  });

export const tokenGenerationQueue = createQueue(QUEUE_NAMES.TOKEN_GENERATION);
export const cardDesignQueue = createQueue(QUEUE_NAMES.CARD_DESIGN);
export const pipelineStepQueue = createQueue(QUEUE_NAMES.PIPELINE_STEP);

// QueueEvents — for listening to completion/failure events server-side
export const tokenGenerationEvents = new QueueEvents(
  QUEUE_NAMES.TOKEN_GENERATION,
  { connection: bullRedisConnection },
);
export const cardDesignEvents = new QueueEvents(QUEUE_NAMES.CARD_DESIGN, {
  connection: bullRedisConnection,
});

// ─────────────────────────────────────────────────────────────────────────────
// PRODUCER HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Enqueue token generation for an order.
 * Creates the JobExecution row BEFORE adding to BullMQ so we have a stable
 * internal ID regardless of whether Redis persists the job ID.
 *
 * @param {{ stepExecutionId, orderId, batchId, schoolId, cardCount, isPreDetails, adminId, ip }}
 * @returns {{ jobExecutionId, bullJobId }}
 */
export const enqueueTokenGeneration = async ({
  stepExecutionId,
  orderId,
  batchId,
  schoolId,
  cardCount,
  isPreDetails,
  adminId,
  ip,
}) => {
  // 1. Create our tracking row first
  const jobExecution = await pipelineRepo.createJobExecution({
    stepExecutionId,
    orderId,
    queueName: QUEUE_NAMES.TOKEN_GENERATION,
    jobName: `generate-tokens-order-${orderId.slice(0, 8)}`,
    payload: {
      orderId,
      batchId,
      schoolId,
      cardCount,
      isPreDetails,
      adminId,
      ip,
    },
    maxAttempts: 3,
  });

  // 2. Add to BullMQ — use our DB row ID as the BullMQ job ID for correlation
  const bullJob = await tokenGenerationQueue.add(
    "generate-tokens",
    {
      jobExecutionId: jobExecution.id,
      orderId,
      batchId,
      schoolId,
      cardCount,
      isPreDetails,
      adminId,
      ip,
    },
    {
      jobId: jobExecution.id, // idempotency: same ID = BullMQ deduplicates
      priority: 1,
    },
  );

  // 3. Store the BullMQ job ID back on our row
  await pipelineRepo.updateJobBullId(jobExecution.id, bullJob.id);

  logger.info(
    `[queue] Enqueued token generation: order=${orderId} jobExec=${jobExecution.id}`,
  );

  return { jobExecutionId: jobExecution.id, bullJobId: bullJob.id };
};

/**
 * Enqueue card design for an order.
 */
export const enqueueCardDesign = async ({
  stepExecutionId,
  orderId,
  schoolId,
  adminId,
  ip,
}) => {
  const jobExecution = await pipelineRepo.createJobExecution({
    stepExecutionId,
    orderId,
    queueName: QUEUE_NAMES.CARD_DESIGN,
    jobName: `design-cards-order-${orderId.slice(0, 8)}`,
    payload: { orderId, schoolId, adminId, ip },
    maxAttempts: 2,
  });

  const bullJob = await cardDesignQueue.add(
    "design-cards",
    {
      jobExecutionId: jobExecution.id,
      orderId,
      schoolId,
      adminId,
      ip,
    },
    { jobId: jobExecution.id },
  );

  await pipelineRepo.updateJobBullId(jobExecution.id, bullJob.id);

  logger.info(
    `[queue] Enqueued card design: order=${orderId} jobExec=${jobExecution.id}`,
  );

  return { jobExecutionId: jobExecution.id, bullJobId: bullJob.id };
};

// ─────────────────────────────────────────────────────────────────────────────
// QUEUE HEALTH
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns counts for all queues — used by the super admin dashboard.
 */
export const getQueueHealth = async () => {
  const [tokenStats, designStats] = await Promise.all([
    tokenGenerationQueue.getJobCounts(
      "active",
      "waiting",
      "failed",
      "completed",
      "delayed",
    ),
    cardDesignQueue.getJobCounts(
      "active",
      "waiting",
      "failed",
      "completed",
      "delayed",
    ),
  ]);

  return {
    token_generation: {
      name: QUEUE_NAMES.TOKEN_GENERATION,
      ...tokenStats,
    },
    card_design: {
      name: QUEUE_NAMES.CARD_DESIGN,
      ...designStats,
    },
  };
};

/**
 * Drain a dead job from the queue (manual recovery from dashboard).
 * Removes from BullMQ and marks our DB row as DEAD.
 */
export const drainDeadJob = async (jobExecutionId, bullJobId) => {
  const job =
    (await tokenGenerationQueue.getJob(bullJobId)) ??
    (await cardDesignQueue.getJob(bullJobId));

  if (job) await job.remove();

  await prisma.jobExecution.update({
    where: { id: jobExecutionId },
    data: { status: "DEAD" },
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// GRACEFUL SHUTDOWN
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Close all queue connections gracefully.
 * Call this during app shutdown to prevent Redis connection leaks.
 */
export const closeQueueConnections = async () => {
  const queues = [tokenGenerationQueue, cardDesignQueue, pipelineStepQueue];
  const events = [tokenGenerationEvents, cardDesignEvents];

  try {
    await Promise.all([
      ...queues.map((queue) => queue.close()),
      ...events.map((event) => event.close()),
    ]);
    await bullRedisConnection.quit();
    logger.info("BullMQ queues closed gracefully");
  } catch (err) {
    logger.error({ err: err.message }, "Error closing BullMQ connections");
    bullRedisConnection.disconnect();
  }
};
