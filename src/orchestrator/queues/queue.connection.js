// =============================================================================
// orchestrator/queues/queue.connection.js — RESQID
// =============================================================================
// FIXED VERSION v2.1 - March 29, 2026
// =============================================================================
//
// CHANGE LOG:
// - Guarded forceCloseQueueConnection to only run in test mode
// - Improved ref count handling and logging clarity
// - Maintains backward compatibility
// =============================================================================

import { workerRedis } from '#config/redis.js';
import { logger } from '#config/logger.js';

let _connection = null;
let _connectionRefCount = 0;

/**
 * Get the shared Redis connection for BullMQ
 * Reuses the existing workerRedis instance from redis.js
 * Prevents duplicate connections and socket exhaustion
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

  _connection = workerRedis;
  _connectionRefCount = 1;

  _connection.on('connect', () => {
    logger.info('[queue.connection] Queue manager connected to Redis');
  });

  _connection.on('error', err => {
    logger.error(
      { err: err.message },
      '[queue.connection] Redis connection error (managed by redis.js)'
    );
  });

  _connection.on('close', () => {
    logger.warn('[queue.connection] Redis connection closed (managed by redis.js)');
  });

  logger.info('[queue.connection] Queue connection initialized (reusing workerRedis)');
  return _connection;
};

/**
 * Close the queue connection
 * NOTE: This does not actually close the shared Redis connection.
 * It only decreases the reference count.
 */
export const closeQueueConnection = async () => {
  if (_connectionRefCount > 0) {
    _connectionRefCount--;
  }

  logger.debug(
    { refCount: _connectionRefCount },
    '[queue.connection] Connection release requested'
  );

  if (_connectionRefCount <= 0) {
    logger.warn(
      '[queue.connection] Ref count zero — connection remains open (managed by redis.js)'
    );
    _connectionRefCount = 0;
  }

  return Promise.resolve();
};

/**
 * Force close connection (safe only in test mode)
 * WARNING: In production this will break ALL Redis users.
 */
export const forceCloseQueueConnection = async () => {
  if (process.env.NODE_ENV !== 'test') {
    logger.error('[queue.connection] Force close attempted outside test mode — blocked');
    return Promise.resolve();
  }

  if (_connection) {
    logger.warn('[queue.connection] Force closing shared Redis connection (TEST MODE)');
    _connection = null;
    _connectionRefCount = 0;
  }

  return Promise.resolve();
};

// Export default for backward compatibility
export default { getQueueConnection, closeQueueConnection };
