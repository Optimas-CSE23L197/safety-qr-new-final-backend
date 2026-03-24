// =============================================================================
// server.js — RESQID (ENHANCED WITH CONSOLE LOGGING)
// HTTP server entry point — binds the Express app to a port
// Handles: clustering, graceful shutdown, startup health checks,
//          unhandled rejections, uncaught exceptions, process signals
//
// Never import application logic here — only server lifecycle concerns
// app.js owns Express config; server.js owns the process lifecycle
// =============================================================================

import cluster from "cluster";
import os from "os";
import http from "http";

import { createApp } from "./app.js";
import { ENV } from "./config/env.js";
import { logger } from "./config/logger.js";
import { disconnectPrisma } from "./config/prisma.js";
import { disconnectRedis } from "./config/redis.js";
import { setupProcessErrorHandlers } from "./middleware/error.middleware.js";

// =============================================================================
// Console Logger for Startup (always visible)
// =============================================================================

const consoleLog = (message, data = {}) => {
  const timestamp = new Date().toISOString();
  const logMsg = `[${timestamp}] ${message}`;
  if (Object.keys(data).length > 0) {
    console.log(logMsg, data);
  } else {
    console.log(logMsg);
  }
};

const consoleError = (message, error) => {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] ❌ ${message}`, error);
};

const consoleSuccess = (message, data = {}) => {
  const timestamp = new Date().toISOString();
  const logMsg = `[${timestamp}] ✅ ${message}`;
  if (Object.keys(data).length > 0) {
    console.log(logMsg, data);
  } else {
    console.log(logMsg);
  }
};

// =============================================================================
// Cluster Configuration
// =============================================================================

const ENABLE_CLUSTER = ENV.IS_PROD && process.env.CLUSTER !== "false";

// In production: one worker per CPU core (up to 4 — diminishing returns above)
// In development: single process (easier debugging, faster restarts)
const WORKER_COUNT = ENABLE_CLUSTER ? Math.min(os.cpus().length, 4) : 1;

consoleLog(
  "╔══════════════════════════════════════════════════════════════════╗",
);
consoleLog(
  "║                      RESQID BACKEND SERVER                        ║",
);
consoleLog(
  "╚══════════════════════════════════════════════════════════════════╝",
);
consoleLog("");
consoleLog(`📦 Environment: ${ENV.NODE_ENV}`);
consoleLog(`🔢 Node version: ${process.version}`);
consoleLog(`💾 PID: ${process.pid}`);
consoleLog(`🖥️  Platform: ${process.platform}`);
consoleLog(`🧠 CPUs: ${os.cpus().length}`);
consoleLog(`⚙️  Cluster: ${ENABLE_CLUSTER ? "enabled" : "disabled"}`);
consoleLog(`👷 Workers: ${WORKER_COUNT}`);
consoleLog("");

// =============================================================================
// Primary Process (Cluster Manager)
// =============================================================================

if (ENABLE_CLUSTER && cluster.isPrimary) {
  runPrimary();
} else {
  runWorker();
}

// =============================================================================
// Primary: Fork workers, watch for exits
// =============================================================================

function runPrimary() {
  consoleSuccess(
    `Primary process ${process.pid} starting ${WORKER_COUNT} workers`,
  );

  logger.info(
    {
      type: "cluster_primary_start",
      pid: process.pid,
      workers: WORKER_COUNT,
      cpus: os.cpus().length,
    },
    `Primary process ${process.pid} starting ${WORKER_COUNT} workers`,
  );

  // Fork all workers
  for (let i = 0; i < WORKER_COUNT; i++) {
    forkWorker(i + 1);
  }

  // Respawn dead workers — but track crash loops
  const crashTracker = new Map(); // workerId → crash timestamps[]

  cluster.on("exit", (worker, code, signal) => {
    const reason = signal ?? `exit code ${code}`;

    consoleError(
      `Worker ${worker.id} (pid ${worker.process.pid}) exited: ${reason}`,
    );

    logger.warn(
      {
        type: "worker_exit",
        workerId: worker.id,
        pid: worker.process.pid,
        code,
        signal,
      },
      `Worker ${worker.id} (pid ${worker.process.pid}) exited: ${reason}`,
    );

    // Crash loop detection — if worker crashes >5 times in 60s, stop respawning
    const now = Date.now();
    const crashes = crashTracker.get(worker.id) ?? [];
    const recentCrashes = crashes.filter((t) => now - t < 60_000);
    recentCrashes.push(now);
    crashTracker.set(worker.id, recentCrashes);

    if (recentCrashes.length > 5) {
      consoleError(`Worker ${worker.id} is crash-looping — not respawning`);
      logger.fatal(
        {
          type: "worker_crash_loop",
          workerId: worker.id,
          crashes: recentCrashes.length,
        },
        `Worker ${worker.id} is crash-looping — not respawning`,
      );
      return;
    }

    // Normal exit (SIGTERM during graceful shutdown) — don't respawn
    if (code === 0 || signal === "SIGTERM") {
      consoleLog(`Worker ${worker.id} exited cleanly — not respawning`);
      logger.info(
        { workerId: worker.id },
        `Worker ${worker.id} exited cleanly — not respawning`,
      );
      return;
    }

    // Unexpected crash — respawn after short delay
    consoleLog(`Respawning worker ${worker.id}`);
    setTimeout(() => forkWorker(worker.id), 1000);
  });

  // Propagate shutdown signals to all workers
  process.on("SIGTERM", () => shutdownPrimary("SIGTERM"));
  process.on("SIGINT", () => shutdownPrimary("SIGINT"));
}

function forkWorker(id) {
  const worker = cluster.fork({ WORKER_ID: String(id) });
  consoleLog(`Worker ${id} forked (pid ${worker.process.pid})`);
  logger.info(
    { type: "worker_forked", workerId: id, pid: worker.process.pid },
    `Worker ${id} forked (pid ${worker.process.pid})`,
  );
  return worker;
}

function shutdownPrimary(signal) {
  consoleLog(`Primary received ${signal} — shutting down all workers`);
  logger.info(
    { signal, type: "primary_shutdown" },
    `Primary received ${signal} — shutting down all workers`,
  );

  const workers = Object.values(cluster.workers ?? {});

  for (const worker of workers) {
    worker?.send("shutdown");
    worker?.disconnect();
  }

  // Force kill after 15s if workers don't exit cleanly
  setTimeout(() => {
    consoleError("Primary forced shutdown — workers did not exit in time");
    process.exit(1);
  }, 15_000).unref();
}

// =============================================================================
// Worker: Start HTTP server
// =============================================================================

async function runWorker() {
  const workerId = process.env.WORKER_ID ?? "1";

  consoleLog(`🟢 Starting worker ${workerId} (pid ${process.pid})...`);

  try {
    // ── Startup Dependency Checks ──────────────────────────────────────────────
    // Verify DB + Redis are reachable before binding to port
    // Fail fast — better to crash at startup than to serve broken requests

    consoleLog(`🔍 Worker ${workerId}: Running startup checks...`);
    await runStartupChecks(workerId);
    consoleSuccess(`Worker ${workerId}: All startup checks passed`);

    // ── Create Express App ─────────────────────────────────────────────────────
    consoleLog(`🏗️  Worker ${workerId}: Creating Express app...`);
    const app = createApp();

    // ── Create HTTP Server ────────────────────────────────────────────────────
    const server = http.createServer(app);

    // ── Server Timeouts ────────────────────────────────────────────────────────
    // keepAliveTimeout must be > load balancer idle timeout (typically 60s)
    // headersTimeout must be > keepAliveTimeout
    server.keepAliveTimeout = 65_000; // 65s — slightly above Nginx/ALB default
    server.headersTimeout = 70_000; // 70s — must be > keepAliveTimeout
    server.requestTimeout = 30_000; // 30s max for any single request
    server.timeout = 30_000; // socket idle timeout

    // ── Register Process Error Handlers ───────────────────────────────────────
    // Unhandled rejections, uncaught exceptions, SIGTERM, SIGINT
    setupProcessErrorHandlers(server);

    // ── Graceful Shutdown on Cluster Message ──────────────────────────────────
    process.on("message", (msg) => {
      if (msg === "shutdown") {
        consoleLog(`Worker ${workerId} received shutdown signal from primary`);
        logger.info(
          { workerId, type: "worker_shutdown_signal" },
          `Worker ${workerId} received shutdown signal from primary`,
        );
        gracefulShutdown(server, workerId, 0);
      }
    });

    // ── Bind to Port ──────────────────────────────────────────────────────────
    consoleLog(`🔌 Worker ${workerId}: Binding to port ${ENV.PORT}...`);
    await new Promise((resolve, reject) => {
      server.listen(ENV.PORT, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });

    const addr = server.address();
    consoleSuccess(
      `Worker ${workerId} listening on port ${addr?.port ?? ENV.PORT}`,
    );

    logger.info(
      {
        type: "server_started",
        workerId,
        pid: process.pid,
        port: addr?.port ?? ENV.PORT,
        env: ENV.NODE_ENV,
        nodeVersion: process.version,
      },
      `Worker ${workerId} listening on port ${addr?.port ?? ENV.PORT}`,
    );

    // ── Log startup summary (worker 1 only — avoid duplicate logs) ────────────
    if (workerId === "1") {
      logStartupSummary(addr?.port ?? ENV.PORT);
    }

    return server;
  } catch (err) {
    consoleError(`Worker ${workerId} failed to start: ${err.message}`, err);
    logger.fatal(
      {
        type: "worker_startup_failed",
        workerId,
        err: err.message,
        stack: err.stack,
      },
      `Worker ${workerId} failed to start: ${err.message}`,
    );
    process.exit(1);
  }
}

// =============================================================================
// Startup Dependency Checks
// =============================================================================

async function runStartupChecks(workerId) {
  consoleLog(`📡 Worker ${workerId}: Checking PostgreSQL connection...`);

  const { checkPrismaHealth } = await import("./config/prisma.js");
  const { checkRedisHealth } = await import("./config/redis.js");

  // Run checks in parallel — fail fast if either is down
  const [dbResult, redisResult] = await Promise.allSettled([
    withStartupTimeout(checkPrismaHealth(), "PostgreSQL", 10_000),
    withStartupTimeout(checkRedisHealth(), "Redis", 5_000),
  ]);

  const dbOk =
    dbResult.status === "fulfilled" && dbResult.value?.status === "ok";
  const redisOk =
    redisResult.status === "fulfilled" && redisResult.value?.status === "ok";

  if (dbOk) {
    consoleSuccess(
      `Worker ${workerId}: PostgreSQL connected (${dbResult.value?.latencyMs}ms)`,
    );
  } else {
    const reason =
      dbResult.status === "rejected"
        ? dbResult.reason?.message
        : dbResult.value?.error;
    consoleError(`Worker ${workerId}: PostgreSQL connection failed: ${reason}`);
    throw new Error(`PostgreSQL not reachable at startup: ${reason}`);
  }

  if (redisOk) {
    consoleSuccess(
      `Worker ${workerId}: Redis connected (${redisResult.value?.latencyMs}ms)`,
    );
  } else {
    const reason =
      redisResult.status === "rejected"
        ? redisResult.reason?.message
        : redisResult.value?.error;
    consoleError(`Worker ${workerId}: Redis connection failed: ${reason}`);
    throw new Error(`Redis not reachable at startup: ${reason}`);
  }

  logger.info(
    {
      type: "startup_checks_passed",
      workerId,
      db: dbResult.value,
      redis: redisResult.value,
    },
    "All startup checks passed — DB and Redis are healthy",
  );
}

function withStartupTimeout(promise, name, timeoutMs) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(`${name} startup check timed out after ${timeoutMs}ms`),
          ),
        timeoutMs,
      ),
    ),
  ]);
}

// =============================================================================
// Graceful Shutdown
// =============================================================================
// Order matters:
//   1. Stop accepting new connections (server.close)
//   2. Wait for in-flight requests to complete
//   3. Disconnect DB pool (flush pending queries)
//   4. Disconnect Redis (flush pending commands)
//   5. Exit

let isShuttingDown = false;

async function gracefulShutdown(server, workerId, exitCode) {
  // Prevent double-shutdown
  if (isShuttingDown) return;
  isShuttingDown = true;

  consoleLog(`🛑 Worker ${workerId} starting graceful shutdown...`);
  logger.info(
    { type: "graceful_shutdown_start", workerId, exitCode },
    `Worker ${workerId} starting graceful shutdown`,
  );

  // Hard timeout — if shutdown takes longer than 15s, force exit
  const forceExit = setTimeout(() => {
    consoleError(
      `Worker ${workerId}: Graceful shutdown timed out — forcing exit`,
    );
    logger.error(
      { type: "forced_shutdown", workerId },
      "Graceful shutdown timed out — forcing exit",
    );
    process.exit(exitCode ?? 1);
  }, 15_000);
  forceExit.unref(); // don't prevent shutdown if nothing else is running

  try {
    // [1] Stop accepting new HTTP connections
    // In-flight requests continue until complete or timeout
    consoleLog(`Worker ${workerId}: Closing HTTP server...`);
    await new Promise((resolve) => {
      server.close((err) => {
        if (err) {
          logger.warn({ err: err.message }, "Server close error");
        }
        resolve();
      });
    });
    consoleSuccess(`Worker ${workerId}: HTTP server closed`);

    // [2] Disconnect Prisma — flushes connection pool
    consoleLog(`Worker ${workerId}: Disconnecting PostgreSQL...`);
    await disconnectPrisma();
    consoleSuccess(`Worker ${workerId}: PostgreSQL disconnected`);

    // [3] Disconnect Redis — sends QUIT command, waits for pending commands
    consoleLog(`Worker ${workerId}: Disconnecting Redis...`);
    await disconnectRedis();
    consoleSuccess(`Worker ${workerId}: Redis disconnected`);

    consoleSuccess(`Worker ${workerId}: Shutdown complete`);
    logger.info(
      { type: "graceful_shutdown_complete", workerId },
      `Worker ${workerId} shutdown complete`,
    );

    clearTimeout(forceExit);
    process.exit(exitCode ?? 0);
  } catch (err) {
    consoleError(`Worker ${workerId}: Error during shutdown: ${err.message}`);
    logger.error(
      { type: "shutdown_error", workerId, err: err.message },
      "Error during graceful shutdown",
    );
    clearTimeout(forceExit);
    process.exit(1);
  }
}

// =============================================================================
// Startup Summary Log
// =============================================================================

function logStartupSummary(port) {
  const lines = [
    "",
    "╔══════════════════════════════════════════════════════════════════╗",
    "║                     RESQID API — STARTED ✅                       ║",
    "╚══════════════════════════════════════════════════════════════════╝",
    "",
    `  📦 Environment  : ${ENV.NODE_ENV}`,
    `  🔌 Port         : ${port}`,
    `  👷 Workers      : ${WORKER_COUNT}`,
    `  🔢 Node.js      : ${process.version}`,
    `  💾 PID          : ${process.pid}`,
    `  🖥️  Platform    : ${process.platform}`,
    `  🔒 Trust Proxy  : ${ENV.TRUST_PROXY}`,
    `  ⚙️  Cluster     : ${ENABLE_CLUSTER ? "enabled" : "disabled"}`,
    "",
    `  🌐 Endpoints:`,
    `  ├── GET  /health              → liveness probe`,
    `  ├── GET  /api/health          → readiness probe`,
    `  ├── GET  /api/status          → version info`,
    `  ├── *    /api/v1/auth         → authentication`,
    `  ├── *    /api/v1/parents      → parent app (mobile)`,
    `  ├── *    /api/v1/scan         → QR scan (public)`,
    `  ├── *    /api/v1/emergency    → emergency profile (public)`,
    `  ├── *    /api/v1/school-admin → school dashboard`,
    `  └── *    /api/v1/super-admin  → super admin dashboard`,
    "",
    `  ✅ Ready to accept requests!`,
    "",
  ];

  lines.forEach((line) => {
    console.log(line);
    if (line.trim()) logger.info(line);
  });
}
