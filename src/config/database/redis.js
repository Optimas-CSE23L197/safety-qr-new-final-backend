// =============================================================================
// redis.js — RESQID
// Production-grade ioredis client singleton
//
// THREE client profiles exported:
//
//   redis            — HTTP request path (state.service, ip-block)
//                      enableOfflineQueue: false → fail fast, never hangs requests
//
//   middlewareRedis  — rate-limiter, session, blacklist, health checks
//                      enableOfflineQueue: true  → survives Redis reconnects at
//                      startup; rate-limit-redis loads a Lua script in its
//                      constructor — this must not crash when called at module
//                      load time before the connection is fully ready
//
//   workerRedis      — BullMQ queues and workers, idempotency/lock ops
//                      enableOfflineQueue: true, maxRetriesPerRequest: null
//                      both values are required by BullMQ
// =============================================================================

import Redis, { Cluster } from 'ioredis';
import { ENV } from '../env.js';
import { logger } from '../logger.js';

// ─── Base Options (shared across all profiles) ────────────────────────────────

function buildBaseOptions() {
  return {
    retryStrategy(times) {
      if (times > 20) {
        logger.fatal(
          { type: 'redis_reconnect_failed', attempts: times },
          'Redis: gave up reconnecting after 20 attempts'
        );
        return null;
      }
      const delay = Math.min(100 * Math.pow(2, times), 30_000);
      logger.warn(
        { type: 'redis_reconnecting', attempt: times, nextRetryMs: delay },
        `Redis: reconnecting in ${delay}ms (attempt ${times})`
      );
      return delay;
    },

    reconnectOnError(err) {
      const targetErrors = ['READONLY', 'ECONNRESET', 'ECONNREFUSED'];
      if (targetErrors.some(e => err.message.includes(e))) {
        return 2;
      }
      return false;
    },

    // ✅ Use ?? not || so explicit 0 in ENV is respected (0 || 10000 = 10000, wrong)
    connectTimeout: ENV.REDIS_CONNECT_TIMEOUT ?? 10_000,
    keepAlive: ENV.REDIS_KEEP_ALIVE ?? 30_000,

    lazyConnect: false,
    enableReadyCheck: true,
    autoResubscribe: true,
    keyPrefix: ENV.REDIS_KEY_PREFIX || 'resqid:',

    ...(ENV.REDIS_PASSWORD && { password: ENV.REDIS_PASSWORD }),
    ...(ENV.REDIS_TLS && {
      tls: { rejectUnauthorized: ENV.IS_PROD },
    }),
  };
}

// ─── Profile: HTTP request path ───────────────────────────────────────────────
//
// enableOfflineQueue: false
//   If Redis is reconnecting, commands throw immediately so state.service.js
//   catches and falls back to DB. Without this, commands queue silently and
//   the HTTP request hangs until the socket timeout fires (the original bug).
//
// commandTimeout: 3_000
//   Hard cap per command. Guards against Redis stalls on the hot path.
//
// maxRetriesPerRequest: 1
//   One retry then throw. Never hold an HTTP request for multiple attempts.

function buildHttpOptions() {
  return {
    ...buildBaseOptions(),
    commandTimeout: ENV.REDIS_COMMAND_TIMEOUT ?? 3_000,
    enableOfflineQueue: false,
    autoResendUnfulfilledCommands: false,
    maxRetriesPerRequest: ENV.REDIS_MAX_RETRIES_PER_REQUEST ?? 1,
  };
}

// ─── Profile: Middleware (rate-limiter, session, blacklist, health checks) ─────
//
// enableOfflineQueue: true
//   rate-limit-redis runs EVAL to load a Lua script inside its constructor,
//   which is called at module load time before the Redis connection is ready.
//   With enableOfflineQueue: false that EVAL is rejected immediately and the
//   process crashes. With true, the command queues and fires once connected.
//   Also used for checkRedisHealth() — startup ping must not throw before
//   the connection is established.
//
// maxRetriesPerRequest: 3
//   More lenient than the HTTP profile — middleware ops are non-critical and
//   a few retries are fine (they don't block a response body from sending).
//
// commandTimeout: 5_000
//   Slightly more generous — Lua script loading on first connect can be slow.

function buildMiddlewareOptions() {
  return {
    ...buildBaseOptions(),
    commandTimeout: 5_000,
    enableOfflineQueue: true,
    autoResendUnfulfilledCommands: true,
    maxRetriesPerRequest: 3,
  };
}

// ─── Profile: BullMQ workers and queues ──────────────────────────────────────
//
// enableOfflineQueue: true
//   Workers must survive Redis reconnects — jobs must not be dropped.
//
// maxRetriesPerRequest: null
//   BullMQ specifically requires null here; it manages its own retry logic.
//
// commandTimeout: 0
//   Disabled — BullMQ manages its own timeouts per operation type.

function buildWorkerOptions() {
  return {
    ...buildBaseOptions(),
    commandTimeout: 0,
    enableOfflineQueue: true,
    autoResendUnfulfilledCommands: true,
    maxRetriesPerRequest: null,
  };
}

// ─── Client Factory ───────────────────────────────────────────────────────────

function createRedisClient(name, options) {
  let client;

  if (ENV.REDIS_SENTINEL === true && ENV.REDIS_SENTINEL_NODES) {
    client = new Redis({
      sentinels: ENV.REDIS_SENTINEL_NODES,
      name: ENV.REDIS_SENTINEL_NAME || 'mymaster',
      ...options,
    });
    logger.info({ type: 'redis_sentinel', client: name }, `Redis [${name}]: using Sentinel mode`);
  } else if (ENV.REDIS_CLUSTER === true && ENV.REDIS_CLUSTER_NODES) {
    client = new Cluster(ENV.REDIS_CLUSTER_NODES, {
      redisOptions: options,
      clusterRetryStrategy: times => {
        if (times > 10) return null;
        return Math.min(100 * Math.pow(2, times), 30_000);
      },
      scaleReads: 'slave',
      maxRedirections: 16,
    });
    logger.info({ type: 'redis_cluster', client: name }, `Redis [${name}]: using Cluster mode`);
  } else {
    client = new Redis(ENV.REDIS_URL, options);
    logger.info({ type: 'redis_single', client: name }, `Redis [${name}]: using single node mode`);
  }

  client.on('connect', () =>
    logger.info({ type: 'redis_connect', client: name }, `Redis [${name}]: connected`)
  );
  client.on('ready', () =>
    logger.info({ type: 'redis_ready', client: name }, `Redis [${name}]: ready`)
  );
  client.on('error', err =>
    logger.error(
      { type: 'redis_error', client: name, err: err.message },
      `Redis [${name}]: error — ${err.message}`
    )
  );
  client.on('close', () =>
    logger.warn({ type: 'redis_close', client: name }, `Redis [${name}]: connection closed`)
  );
  client.on('reconnecting', delay =>
    logger.warn(
      { type: 'redis_reconnecting', client: name, delay },
      `Redis [${name}]: reconnecting in ${delay}ms`
    )
  );
  client.on('end', () =>
    logger.warn(
      { type: 'redis_end', client: name },
      `Redis [${name}]: connection permanently closed`
    )
  );

  return client;
}

// ─── Singletons ───────────────────────────────────────────────────────────────

const g = globalThis;

/**
 * HTTP-path client.
 * Import this in: state.service.js, ipBlock middleware.
 * enableOfflineQueue: false — throws immediately on reconnect, never hangs requests.
 */
export const redis = g.__redis ?? (g.__redis = createRedisClient('main', buildHttpOptions()));

/**
 * Middleware client.
 * Import this in: rateLimit.middleware.js, slowDown.middleware.js,
 *                 session middleware, blacklist checks.
 * enableOfflineQueue: true — Lua script loading at startup works correctly.
 * Also used by checkRedisHealth() — startup ping must not throw before connected.
 */
export const middlewareRedis =
  g.__middlewareRedis ??
  (g.__middlewareRedis = createRedisClient('middleware', buildMiddlewareOptions()));

/**
 * BullMQ worker/queue client.
 * Import this in: queue.manager.js, workers/index.js, idempotency.service.js.
 * enableOfflineQueue: true, maxRetriesPerRequest: null — required by BullMQ.
 */
export const workerRedis =
  g.__workerRedis ?? (g.__workerRedis = createRedisClient('worker', buildWorkerOptions()));

// ─── Pub/Sub Client Factory ───────────────────────────────────────────────────

/**
 * Create a fresh pub/sub client.
 * Each call returns a NEW client — pub/sub clients cannot share a connection
 * with command clients (ioredis restriction after SUBSCRIBE is called).
 */
export function createPubSubClient(name = 'pubsub') {
  return createRedisClient(name, buildWorkerOptions());
}

/**
 * Create a fresh BullMQ-compatible client.
 * BullMQ calls this internally — each Queue/Worker needs its own connection.
 */
export function createWorkerRedisClient(name = 'worker') {
  return createRedisClient(name, buildWorkerOptions());
}

// ─── Health Check ─────────────────────────────────────────────────────────────

export async function checkRedisHealth() {
  const start = Date.now();
  try {
    const result = await Promise.race([
      // ✅ FIX: was redis.ping() — the HTTP-path client has
      // enableOfflineQueue: false, so ping() throws immediately at startup
      // before the TCP connection is established, causing the server to refuse
      // to start. middlewareRedis has enableOfflineQueue: true so the ping
      // queues and fires once connected, exactly what a startup check needs.
      middlewareRedis.ping(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 2000)),
    ]);
    if (result !== 'PONG') {
      return { status: 'error', error: 'Unexpected PING response' };
    }
    return { status: 'ok', latencyMs: Date.now() - start };
  } catch (err) {
    logger.error({ err: err.message, type: 'redis_health_check' }, 'Redis health check failed');
    return { status: 'error', error: err.message };
  }
}

// ─── Connection Pool Stats ────────────────────────────────────────────────────

export async function getRedisStats() {
  try {
    const info = await redis.info('stats');

    const extractValue = (str, key) => {
      const match = str.match(new RegExp(`${key}:(\\S+)`));
      return match ? match[1] : null;
    };

    return {
      status: redis.status,
      connected: redis.status === 'ready',
      mode: ENV.REDIS_SENTINEL ? 'sentinel' : ENV.REDIS_CLUSTER ? 'cluster' : 'single',
      total_commands_processed: extractValue(info, 'total_commands_processed'),
      connected_clients: extractValue(info, 'connected_clients'),
      rejected_connections: extractValue(info, 'rejected_connections'),
      used_memory: extractValue(info, 'used_memory_human'),
      uptime_seconds: extractValue(info, 'uptime_in_seconds'),
    };
  } catch (err) {
    return { error: err.message };
  }
}

// ─── Graceful Disconnect ──────────────────────────────────────────────────────

export async function disconnectRedis() {
  try {
    await Promise.allSettled([redis.quit(), middlewareRedis.quit(), workerRedis.quit()]);
    logger.info('All Redis clients disconnected gracefully');
  } catch (err) {
    redis.disconnect();
    middlewareRedis.disconnect();
    workerRedis.disconnect();
    logger.error({ err: err.message }, 'Redis disconnect error — forced');
  }
}
