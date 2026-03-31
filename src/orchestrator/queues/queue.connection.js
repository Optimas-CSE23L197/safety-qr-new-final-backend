import Redis from 'ioredis';
import { logger } from '#config/logger.js';

let _connection = null;
let _connectionRefCount = 0;

export const getQueueConnection = () => {
  if (_connection) {
    _connectionRefCount++;
    return _connection;
  }

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error('[queue.connection] REDIS_URL is required');
  }

  _connection = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: false,
    retryStrategy: times => {
      const delay = Math.min(times * 100, 3000);
      return delay;
    },
    connectTimeout: 10000,
    keepAlive: 30000,
  });

  _connectionRefCount = 1;

  _connection.on('connect', () => {
    logger.info('[queue.connection] BullMQ Redis connection established');
  });

  _connection.on('error', err => {
    logger.error({ err: err.message }, '[queue.connection] Redis connection error');
  });

  return _connection;
};

export const closeQueueConnection = async () => {
  if (_connectionRefCount > 0) _connectionRefCount--;

  if (_connectionRefCount <= 0 && _connection) {
    await _connection.quit();
    _connection = null;
    logger.info('[queue.connection] Connection closed');
  }
};

export default { getQueueConnection, closeQueueConnection };
