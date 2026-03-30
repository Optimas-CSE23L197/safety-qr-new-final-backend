// =============================================================================
// orchestrator/queues/queue.connection.js — RESQID
// =============================================================================
// FIXED VERSION v3.0 - March 30, 2026
// =============================================================================
//
// CHANGE LOG:
// - Removed dependency on workerRedis from redis.js because it has keyPrefix
// - BullMQ cannot work with Redis clients that have keyPrefix
// - Create fresh Redis connection without any prefix for BullMQ
// =============================================================================

import Redis from 'ioredis';
import { logger } from '#config/logger.js';

let _connection = null;
let _connectionRefCount = 0;

/**
 * Get a clean Redis connection for BullMQ
 * BullMQ requires a Redis client WITHOUT keyPrefix
 * It manages its own prefixes internally
 */
export const getQueueConnection = () => {
  if (_connection) {
    _connectionRefCount++;
    logger.debug(
      { refCount: _connectionRefCount },
      '[queue.connection] Reusing existing connection'
    );
    return _connection;
  }

  // Create a fresh Redis connection specifically for BullMQ
  // IMPORTANT: No keyPrefix here - BullMQ manages its own prefixes
  _connection = new Redis({
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB || '0'),

    // BullMQ specific requirements
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: false,

    // Retry strategy
    retryStrategy: times => {
      const delay = Math.min(times * 100, 3000);
      logger.warn({ times, delay }, '[queue.connection] Retrying Redis connection');
      return delay;
    },

    // Connection timeouts
    connectTimeout: 10000,
    keepAlive: 30000,

    // IMPORTANT: DO NOT set keyPrefix here
    // keyPrefix: 'anything' - This would break BullMQ!
  });

  _connectionRefCount = 1;

  _connection.on('connect', () => {
    logger.info('[queue.connection] BullMQ Redis connection established');
  });

  _connection.on('ready', () => {
    logger.info('[queue.connection] BullMQ Redis ready');
  });

  _connection.on('error', err => {
    logger.error({ err: err.message }, '[queue.connection] Redis connection error');
  });

  _connection.on('close', () => {
    logger.warn('[queue.connection] Redis connection closed');
  });

  _connection.on('reconnecting', () => {
    logger.warn('[queue.connection] Redis reconnecting');
  });

  logger.info('[queue.connection] Queue connection initialized (clean Redis for BullMQ)');
  return _connection;
};

/**
 * Close the queue connection
 */
export const closeQueueConnection = async () => {
  if (_connectionRefCount > 0) {
    _connectionRefCount--;
  }

  logger.debug(
    { refCount: _connectionRefCount },
    '[queue.connection] Connection release requested'
  );

  if (_connectionRefCount <= 0 && _connection) {
    await _connection.quit();
    _connection = null;
    logger.info('[queue.connection] Connection closed');
  }

  return Promise.resolve();
};

/**
 * Force close connection (safe only in test mode)
 */
export const forceCloseQueueConnection = async () => {
  if (process.env.NODE_ENV !== 'test') {
    logger.error('[queue.connection] Force close attempted outside test mode — blocked');
    return Promise.resolve();
  }

  if (_connection) {
    logger.warn('[queue.connection] Force closing Redis connection (TEST MODE)');
    await _connection.quit();
    _connection = null;
    _connectionRefCount = 0;
  }

  return Promise.resolve();
};

// Export default for backward compatibility
export default { getQueueConnection, closeQueueConnection };
