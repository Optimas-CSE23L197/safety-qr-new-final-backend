// =============================================================================
// redis.js — RESQID
// Production-grade ioredis client singleton
// - Single shared client for all middleware (rate limit, session, blacklist)
// - TLS support for Redis in production
// - Exponential backoff reconnect strategy
// - Dedicated pub/sub client factory (ioredis can't multiplex subscribe + commands)
// - Health check export for /health endpoint
// - Graceful disconnect on shutdown
// =============================================================================

import Redis, { Cluster } from "ioredis";
import { ENV } from "./env.js";
import { logger } from "./logger.js";

// ─── Connection Options ───────────────────────────────────────────────────────

function buildRedisOptions() {
  const options = {
    // Reconnect strategy — exponential backoff capped at 30 seconds
    retryStrategy(times) {
      if (times > 20) {
        logger.fatal(
          { type: "redis_reconnect_failed", attempts: times },
          "Redis: gave up reconnecting after 20 attempts",
        );
        return null;
      }
      const delay = Math.min(100 * Math.pow(2, times), 30_000);
      logger.warn(
        { type: "redis_reconnecting", attempt: times, nextRetryMs: delay },
        `Redis: reconnecting in ${delay}ms (attempt ${times})`,
      );
      return delay;
    },

    // Reconnect on specific errors
    reconnectOnError(err) {
      const targetErrors = ["READONLY", "ECONNRESET", "ECONNREFUSED"];
      if (targetErrors.some((e) => err.message.includes(e))) {
        return 2;
      }
      return false;
    },

    // Connection timeouts — using ENV variables
    connectTimeout: ENV.REDIS_CONNECT_TIMEOUT || 10_000,
    commandTimeout: ENV.REDIS_COMMAND_TIMEOUT || 5_000,
    keepAlive: ENV.REDIS_KEEP_ALIVE || 30_000,

    // Lazy connect — connect immediately so startup health check works
    lazyConnect: false,

    // Max retries per request — using ENV variable
    maxRetriesPerRequest: ENV.REDIS_MAX_RETRIES_PER_REQUEST || 3,

    // Enable offline queue — commands issued during reconnect are queued
    enableOfflineQueue: true,
    enableReadyCheck: true,
    autoResubscribe: true,
    autoResendUnfulfilledCommands: true,

    // Key prefix for multi-tenancy
    keyPrefix: ENV.REDIS_KEY_PREFIX || "resqid:",

    // Password
    ...(ENV.REDIS_PASSWORD && { password: ENV.REDIS_PASSWORD }),

    // TLS — required in production with TLS-enabled Redis
    ...(ENV.REDIS_TLS && {
      tls: {
        rejectUnauthorized: ENV.IS_PROD,
      },
    }),
  };

  return options;
}

// ─── Client Factory ───────────────────────────────────────────────────────────

function createRedisClient(name = "main") {
  let client;

  // Redis Sentinel (High Availability)
  if (ENV.REDIS_SENTINEL === true && ENV.REDIS_SENTINEL_NODES) {
    client = new Redis({
      sentinels: ENV.REDIS_SENTINEL_NODES,
      name: ENV.REDIS_SENTINEL_NAME || "mymaster",
      ...buildRedisOptions(),
    });
    logger.info(
      { type: "redis_sentinel", client: name, nodes: ENV.REDIS_SENTINEL_NODES.length },
      `Redis [${name}]: using Sentinel mode`,
    );
  }
  // Redis Cluster (Sharding)
  else if (ENV.REDIS_CLUSTER === true && ENV.REDIS_CLUSTER_NODES) {
    client = new Cluster(ENV.REDIS_CLUSTER_NODES, {
      redisOptions: buildRedisOptions(),
      clusterRetryStrategy: (times) => {
        if (times > 10) return null;
        return Math.min(100 * Math.pow(2, times), 30_000);
      },
      scaleReads: "slave",
      maxRedirections: 16,
    });
    logger.info(
      { type: "redis_cluster", client: name, nodes: ENV.REDIS_CLUSTER_NODES.length },
      `Redis [${name}]: using Cluster mode`,
    );
  }
  // Single Node (Default)
  else {
    client = new Redis(ENV.REDIS_URL, buildRedisOptions());
    logger.info({ type: "redis_single", client: name }, `Redis [${name}]: using single node mode`);
  }

  // ── Event Handlers ─────────────────────────────────────────────────────────

  client.on("connect", () => {
    logger.info({ type: "redis_connect", client: name }, `Redis [${name}]: connected`);
  });

  client.on("ready", () => {
    logger.info({ type: "redis_ready", client: name }, `Redis [${name}]: ready`);
  });

  client.on("error", (err) => {
    logger.error(
      { type: "redis_error", client: name, err: err.message },
      `Redis [${name}]: error — ${err.message}`,
    );
  });

  client.on("close", () => {
    logger.warn({ type: "redis_close", client: name }, `Redis [${name}]: connection closed`);
  });

  client.on("reconnecting", (delay) => {
    logger.warn(
      { type: "redis_reconnecting", client: name, delay },
      `Redis [${name}]: reconnecting in ${delay}ms`,
    );
  });

  client.on("end", () => {
    logger.warn({ type: "redis_end", client: name }, `Redis [${name}]: connection permanently closed`);
  });

  return client;
}

// ─── Singleton Client ─────────────────────────────────────────────────────────

const globalForRedis = globalThis;

export const redis =
  globalForRedis.__redis ??
  (globalForRedis.__redis = createRedisClient("main"));

// ─── Pub/Sub Client Factory ───────────────────────────────────────────────────

export function createPubSubClient(name = "pubsub") {
  return createRedisClient(name);
}

// ─── Health Check ─────────────────────────────────────────────────────────────

export async function checkRedisHealth() {
  const start = Date.now();
  try {
    const result = await Promise.race([
      redis.ping(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 2000)),
    ]);

    const latencyMs = Date.now() - start;

    if (result !== "PONG") {
      return { status: "error", error: "Unexpected PING response" };
    }

    return { status: "ok", latencyMs };
  } catch (err) {
    logger.error({ err: err.message, type: "redis_health_check" }, "Redis health check failed");
    return { status: "error", error: err.message };
  }
}

// ─── Connection Pool Stats ────────────────────────────────────────────────────

export async function getRedisStats() {
  try {
    const info = await redis.info("stats");
    const clients = await redis.client("list");

    const extractValue = (info, key) => {
      const match = info.match(new RegExp(`${key}:(\\S+)`));
      return match ? match[1] : null;
    };

    return {
      status: redis.status,
      connected: redis.status === "ready",
      mode: ENV.REDIS_SENTINEL ? "sentinel" : ENV.REDIS_CLUSTER ? "cluster" : "single",
      total_commands_processed: extractValue(info, "total_commands_processed"),
      connected_clients: extractValue(info, "connected_clients"),
      rejected_connections: extractValue(info, "rejected_connections"),
      used_memory: extractValue(info, "used_memory_human"),
      uptime_seconds: extractValue(info, "uptime_in_seconds"),
    };
  } catch (err) {
    return { error: err.message };
  }
}

// ─── Graceful Disconnect ──────────────────────────────────────────────────────

export async function disconnectRedis() {
  try {
    await redis.quit();
    logger.info("Redis disconnected gracefully");
  } catch (err) {
    redis.disconnect();
    logger.error({ err: err.message }, "Redis disconnect error — forced");
  }
}