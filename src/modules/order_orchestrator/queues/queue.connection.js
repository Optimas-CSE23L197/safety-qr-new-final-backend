// src/modules/order_orchestrator/queues/queue.connection.js
import { redis } from "../../../config/redis.js";

export const QUEUE_CONNECTION = {
  client: redis,
};

export const DEFAULT_JOB_OPTIONS = {
  removeOnComplete: { count: 100 },
  removeOnFail: false,
  attempts: 3,
  backoff: { type: "exponential", delay: 2000 },
};
