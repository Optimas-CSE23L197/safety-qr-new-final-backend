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

import Redis from "ioredis";
import { ENV } from "./env.js";
import { logger } from "./logger.js";

// ─── Connection Options ───────────────────────────────────────────────────────

function buildRedisOptions() {
  const options = {
    // Reconnect strategy — exponential backoff capped at 30 seconds
    // Prevents hammering a restarting Redis instance
    retryStrategy(times) {
      if (times > 20) {
        // After 20 attempts (~5 min), stop retrying and alert
        logger.fatal(
          { type: "redis_reconnect_failed", attempts: times },
          "Redis: gave up reconnecting after 20 attempts",
        );
        return null; // stop retrying
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
        return 2; // reconnect and resend the failed command
      }
      return false;
    },

    // Connection timeout — fail fast if Redis is unreachable at startup
    connectTimeout: 10_000, // 10 seconds to establish initial connection
    commandTimeout: 5_000, // 5 seconds max per command
    keepAlive: 30_000, // TCP keepalive every 30 seconds

    // Lazy connect — don't connect until first command
    // Prevents startup failure if Redis is temporarily unavailable
    lazyConnect: false, // Connect immediately so startup health check works

    // Max retries per request — don't retry reads indefinitely
    maxRetriesPerRequest: 3,

    // Enable offline queue — commands issued during reconnect are queued
    enableOfflineQueue: true,

    // Password
    ...(ENV.REDIS_PASSWORD && { password: ENV.REDIS_PASSWORD }),

    // TLS — required in production with TLS-enabled Redis (Redis Cloud, ElastiCache)
    ...(ENV.REDIS_TLS && {
      tls: {
        rejectUnauthorized: ENV.IS_PROD, // strict in prod, lenient in dev
      },
    }),
  };

  return options;
}

// ─── Client Factory ───────────────────────────────────────────────────────────

function createRedisClient(name = "main") {
  const client = new Redis(ENV.REDIS_URL, buildRedisOptions());

  // ── Event Handlers ─────────────────────────────────────────────────────────

  client.on("connect", () => {
    logger.info(
      { type: "redis_connect", client: name },
      `Redis [${name}]: connected`,
    );
  });

  client.on("ready", () => {
    logger.info(
      { type: "redis_ready", client: name },
      `Redis [${name}]: ready`,
    );
  });

  client.on("error", (err) => {
    // Log but don't crash — ioredis handles reconnection automatically
    logger.error(
      { type: "redis_error", client: name, err: err.message },
      `Redis [${name}]: error — ${err.message}`,
    );
  });

  client.on("close", () => {
    logger.warn(
      { type: "redis_close", client: name },
      `Redis [${name}]: connection closed`,
    );
  });

  client.on("reconnecting", (delay) => {
    logger.warn(
      { type: "redis_reconnecting", client: name, delay },
      `Redis [${name}]: reconnecting in ${delay}ms`,
    );
  });

  client.on("end", () => {
    logger.warn(
      { type: "redis_end", client: name },
      `Redis [${name}]: connection permanently closed`,
    );
  });

  return client;
}

// ─── Singleton Client ─────────────────────────────────────────────────────────
// Shared across all middleware — rate limiting, sessions, blacklist, device cache

const globalForRedis = globalThis;

export const redis =
  globalForRedis.__redis ??
  (globalForRedis.__redis = createRedisClient("main"));

// ─── Pub/Sub Client Factory ───────────────────────────────────────────────────
// ioredis cannot use subscribe() and normal commands on the same connection
// Create dedicated clients for pub/sub when needed (notifications, cache invalidation)

/**
 * createPubSubClient
 * Creates a dedicated ioredis client for subscribe/publish operations
 * Caller is responsible for disconnecting when done
 */
export function createPubSubClient(name = "pubsub") {
  return createRedisClient(name);
}

// ─── Health Check ─────────────────────────────────────────────────────────────

/**
 * checkRedisHealth
 * Sends a PING and measures latency
 * Used by /health endpoint
 */
export async function checkRedisHealth() {
  const start = Date.now();
  try {
    const result = await redis.ping();
    const latencyMs = Date.now() - start;

    if (result !== "PONG") {
      return { status: "error", error: "Unexpected PING response" };
    }

    return { status: "ok", latencyMs };
  } catch (err) {
    logger.error(
      { err: err.message, type: "redis_health_check" },
      "Redis health check failed",
    );
    return { status: "error", error: err.message };
  }
}

// ─── Graceful Disconnect ──────────────────────────────────────────────────────

export async function disconnectRedis() {
  try {
    await redis.quit(); // QUIT command — waits for pending commands
    logger.info("Redis disconnected gracefully");
  } catch (err) {
    // Force disconnect if QUIT fails
    redis.disconnect();
    logger.error({ err: err.message }, "Redis disconnect error — forced");
  }
}
