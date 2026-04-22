// =============================================================================
// orchestrator/queues/queue.connection.js — RESQID
//
// Returns a plain ioredis OPTIONS OBJECT, not a shared instance.
// BullMQ calls .duplicate() internally — passing a shared instance causes
// connection leaks. Passing a config object lets BullMQ manage its own pool.
//
// keepAlive: 300000 — TCP keepalive every 5 min (was 30s = 10x fewer pings)
// =============================================================================

import { logger } from '#config/logger.js';

export const getQueueConnection = () => {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error('[queue.connection] REDIS_URL is required');
  }

  return {
    url: redisUrl,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: false,
    retryStrategy: times => Math.min(times * 100, 3000),
    connectTimeout: 10000,
    keepAlive: 300000,
  };
};

// Kept for graceful shutdown compatibility — no-op now since BullMQ manages
// its own connections from the config object above.
export const closeQueueConnection = async () => {
  logger.info('[queue.connection] Connection lifecycle managed by BullMQ');
};

export default { getQueueConnection, closeQueueConnection };
