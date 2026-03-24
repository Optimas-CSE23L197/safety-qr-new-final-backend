// =============================================================================
// prisma.js — RESQID
// Singleton Prisma client with production-safe configuration
// - Single instance across the entire app (prevents connection pool exhaustion)
// - Query logging in development (slow query detection)
// - Soft-delete awareness
// - Graceful shutdown on process signals
// - Connection health check export for /health endpoint
// =============================================================================

import { PrismaClient } from "../generated/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { ENV } from "./env.js";
import { logger } from "./logger.js";

// ─── Slow Query Threshold ─────────────────────────────────────────────────────
const SLOW_QUERY_MS = 1000; // log queries taking longer than 1 second

// ─── Log Config ───────────────────────────────────────────────────────────────
// In development: log queries, info, warnings, errors
// In production: log only errors (queries are too noisy)

const LOG_CONFIG = ENV.IS_DEV
  ? [
      { emit: "event", level: "query" },
      { emit: "event", level: "info" },
      { emit: "event", level: "warn" },
      { emit: "event", level: "error" },
    ]
  : [
      { emit: "event", level: "warn" },
      { emit: "event", level: "error" },
    ];

// ─── Prisma Client Singleton ──────────────────────────────────────────────────

function createPrismaClient() {
  // Prisma v7 client engine requires a driver adapter — no Rust engine
  const adapter = new PrismaPg({ connectionString: ENV.DATABASE_URL });

  const client = new PrismaClient({
    adapter,
    log: LOG_CONFIG,

    // Error formatting — minimal in production (no stack traces in logs)
    errorFormat: ENV.IS_PROD ? "minimal" : "pretty",
  });

  // ── Query Logging (development only) ───────────────────────────────────────
  if (ENV.IS_DEV) {
    client.$on("query", (e) => {
      const duration = e.duration;

      if (duration >= SLOW_QUERY_MS) {
        // Slow query — log at warn level with full query for debugging
        logger.warn(
          {
            type: "slow_query",
            query: e.query,
            params: e.params,
            durationMs: duration,
            target: e.target,
          },
          `Slow query detected: ${duration}ms`,
        );
      } else {
        // Normal query — log at debug level (not emitted in production)
        logger.debug(
          {
            type: "db_query",
            query: e.query,
            durationMs: duration,
          },
          `DB query: ${duration}ms`,
        );
      }
    });

    client.$on("info", (e) => {
      logger.info({ type: "prisma_info", message: e.message }, "Prisma info");
    });
  }

  // ── Warn + Error logging (all environments) ────────────────────────────────
  client.$on("warn", (e) => {
    logger.warn({ type: "prisma_warn", message: e.message }, "Prisma warning");
  });

  client.$on("error", (e) => {
    logger.error({ type: "prisma_error", message: e.message }, "Prisma error");
  });

  return client;
}

// ─── Global Singleton ─────────────────────────────────────────────────────────
// Prevents multiple Prisma instances during hot-reload in development
// (Next.js / Vite HMR issue — same pattern applies here)

const globalForPrisma = globalThis;

export const prisma =
  globalForPrisma.__prisma ?? (globalForPrisma.__prisma = createPrismaClient());

// ─── Connection Health Check ──────────────────────────────────────────────────

/**
 * checkPrismaHealth
 * Runs a cheap raw query to verify DB connectivity
 * Used by /health endpoint
 */
export async function checkPrismaHealth() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { status: "ok", latencyMs: null };
  } catch (err) {
    logger.error(
      { err: err.message, type: "db_health_check" },
      "DB health check failed",
    );
    return { status: "error", error: err.message };
  }
}

// ─── Graceful Disconnect ──────────────────────────────────────────────────────
// Called by setupProcessErrorHandlers in error.middleware.js

export async function disconnectPrisma() {
  try {
    await prisma.$disconnect();
    logger.info("Prisma disconnected gracefully");
  } catch (err) {
    logger.error({ err: err.message }, "Prisma disconnect error");
  }
}
