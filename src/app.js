// =============================================================================
// app.js — RESQID (UPDATED with Order Orchestrator)
// =============================================================================

import express from "express";
import cookieParser from "cookie-parser";
import compression from "compression";
import "dotenv/config";

// ─── Config ───────────────────────────────────────────────────────────────────
import { ENV } from "./config/env.js";
import { logger } from "./config/logger.js";

// ─── Middleware ───────────────────────────────────────────────────────────────
import { requestId } from "./middleware/requestId.middleware.js";
import { httpLogger } from "./middleware/httpLogger.middleware.js";
import { helmetMiddleware } from "./middleware/helmet.middleware.js";
import {
  corsMiddleware,
  handleCorsError,
} from "./middleware/cors.middleware.js";
import { hppProtection } from "./middleware/hpp.middleware.js";
import { sanitizeDeep } from "./middleware/sanitize.middleware.js";
import { sanitizeXss } from "./middleware/xss.middleware.js";
import { maintenanceMode } from "./middleware/maintenanceMode.middleware.js";
import { apiVersion } from "./middleware/apiVersion.middleware.js";
import { enforceContentType } from "./middleware/contentType.middleware.js";
import { enforceRequestSize } from "./middleware/requestSize.middleware.js";
import {
  globalErrorHandler,
  notFoundHandler,
} from "./middleware/error.middleware.js";
import { ipBlockMiddleware } from "./middleware/ipBlock.middleware.js";
import { attackLogger } from "./middleware/attackLogger.middleware.js";
import {
  behavioralSecurity,
  recordFailedAuth,
  recordSuccessfulAuth,
} from "./middleware/behavioralSecurity.middleware.js";
import scanRoute from "./modules/scan/scan.routes.js";

// ─── Routes ───────────────────────────────────────────────────────────────────
import router from "./routes/index.js";
import { accessLogger } from "./middleware/morgan.middleware.js";

function validateCloudflareRequest(req, res, next) {
  if (!ENV.CLOUDFLARE_ONLY || ENV.NODE_ENV !== "production") {
    return next();
  }

  if (req.path === "/health" || req.path === "/api/health") {
    return next();
  }

  const cfConnectingIp = req.headers["cf-connecting-ip"];
  if (!cfConnectingIp) {
    logger.warn(
      { ip: req.ip, path: req.path, requestId: req.id },
      "Direct origin hit detected — possible Cloudflare bypass attempt",
    );
    return res.status(403).json({
      success: false,
      message: "Forbidden",
      requestId: req.id,
    });
  }

  req.realIp = cfConnectingIp;
  next();
}

// =============================================================================
// App Factory
// =============================================================================

export function createApp() {
  logger.info("🟢 Creating Express app...");
  const app = express();

  // ── [1] Trust Proxy ──────────────────────────────────────────────────────────
  logger.info({ trustProxy: ENV.TRUST_PROXY }, "Setting trust proxy");
  app.set("trust proxy", ENV.TRUST_PROXY);
  app.disable("x-powered-by");
  app.disable("etag");

  // ── [2] Maintenance Mode ─────────────────────────────────────────────────────
  logger.info("✅ Loading maintenance mode middleware");
  app.use(maintenanceMode);

  // ── [3] Request ID ───────────────────────────────────────────────────────────
  logger.info("✅ Loading request ID middleware");
  app.use(requestId);

  // ── [4] HTTP Logger ──────────────────────────────────────────────────────────
  logger.info("✅ Loading HTTP logger middleware");
  app.use(accessLogger);
  app.use(httpLogger);

  // ── [5] Security Headers ────────────────────────────────────────────────────
  logger.info("✅ Loading Helmet security headers");
  app.use(helmetMiddleware);

  // ── [6] Permissions-Policy ──────────────────────────────────────────────────
  app.use((_req, res, next) => {
    res.setHeader(
      "Permissions-Policy",
      "geolocation=(), microphone=(), camera=(), payment=(), usb=(), fullscreen=()",
    );
    next();
  });

  // ── [7] IP Block (Redis fast path) ──────────────────────────────────────────
  logger.info("✅ Loading IP block middleware");
  app.use(ipBlockMiddleware);

  // ── [8] Cloudflare Request Validation ───────────────────────────────────────
  logger.info(
    { cloudflareOnly: ENV.CLOUDFLARE_ONLY },
    "Loading Cloudflare validation middleware",
  );
  app.use(validateCloudflareRequest);

  // ── [9] CORS ─────────────────────────────────────────────────────────────────
  logger.info("✅ Loading CORS middleware");
  app.use(corsMiddleware);
  app.use(handleCorsError);

  // ── [10] Health + Readiness Endpoints ───────────────────────────────────────
  logger.info("✅ Registering health endpoints");
  registerHealthEndpoints(app);

  // ── [11] Request Size Limits ─────────────────────────────────────────────────
  logger.info("✅ Loading request size limit middleware");
  app.use(enforceRequestSize);

  // ── [12] Content-Type Enforcement ───────────────────────────────────────────
  logger.info("✅ Loading content-type enforcement middleware");
  app.use(enforceContentType);

  // ── [13] Body Parsing ────────────────────────────────────────────────────────
  logger.info("✅ Loading body parsers (JSON, URL encoded)");
  app.use(
    express.json({
      limit: "20kb",
      strict: true,
      type: ["application/json", "application/vnd.api+json"],
    }),
  );

  // ── [14] Cookie Parser ───────────────────────────────────────────────────────
  logger.info("✅ Loading cookie parser");
  app.use(cookieParser());

  // ── [15] HTTP Parameter Pollution ───────────────────────────────────────────
  logger.info("✅ Loading HPP protection");
  app.use(hppProtection);

  // ── [16] Deep Object Sanitization ───────────────────────────────────────────
  logger.info("✅ Loading deep sanitization middleware");
  app.use(sanitizeDeep);

  // ── [17] Attack Logger ───────────────────────────────────────────────────────
  logger.info("✅ Loading attack logger middleware");
  app.use(attackLogger);

  // ── [18] XSS Sanitization ────────────────────────────────────────────────────
  logger.info("✅ Loading XSS sanitization middleware");
  app.use(sanitizeXss);

  // ═══════════════════════════════════════════════════════════════════════════
  // ║  BEHAVIORAL SECURITY MIDDLEWARE                                         ║
  // ═══════════════════════════════════════════════════════════════════════════
  logger.info("✅ Loading behavioral security middleware");
  app.use(behavioralSecurity);

  // ── [19] Public scan routes (exempt from auth) ──────────────────────────────
  logger.info("✅ Registering public scan routes at /s");
  app.use("/s", scanRoute);

  // ── [20] API Version ─────────────────────────────────────────────────────────
  logger.info("✅ Loading API version middleware");
  app.use(apiVersion);

  // ── [21] Compression ─────────────────────────────────────────────────────────
  logger.info("✅ Loading compression middleware");
  app.use(
    compression({
      level: 6,
      threshold: 1024,
      filter: (req, res) => {
        if (req.headers["x-no-compression"]) return false;
        return compression.filter(req, res);
      },
    }),
  );

  // ── [22] Application Routes ───────────────────────────────────────────────────
  logger.info("✅ Registering application routes at /api/:version");
  app.use("/api/:version", router);

  // ── [23] 404 Handler ─────────────────────────────────────────────────────────
  logger.info("✅ Loading 404 handler");
  app.use(notFoundHandler);

  // ── [24] Global Error Handler ────────────────────────────────────────────────
  logger.info("✅ Loading global error handler");
  app.use(globalErrorHandler);

  logger.info(
    {
      type: "app_created",
      env: ENV.NODE_ENV,
      trustProxy: ENV.TRUST_PROXY,
      port: ENV.PORT,
      nodeVersion: process.version,
    },
    "✅ Express app created successfully!",
  );

  return app;
}

// =============================================================================
// Health + Readiness Endpoints (Enhanced with detailed logging)
// =============================================================================

function registerHealthEndpoints(app) {
  // Simple liveness probe
  app.get("/health", (_req, res) => {
    res.status(200).json({
      status: "ok",
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      env: ENV.NODE_ENV,
    });
  });

  // Detailed readiness probe with service checks
  app.get("/api/health", async (_req, res) => {
    const startTime = Date.now();

    logger.debug("Health check initiated");

    const { checkPrismaHealth } = await import("./config/prisma.js");
    const { checkRedisHealth } = await import("./config/redis.js");
    const { getBehavioralReport } =
      await import("./middleware/behavioralSecurity.middleware.js");

    // Check queue health
    let queueHealth = { status: "unknown" };
    try {
      const { getQueueHealth } =
        await import("./modules/order_orchestrator/queues/queue.manager.js");
      queueHealth = await getQueueHealth();
    } catch (err) {
      queueHealth = { status: "error", error: err.message };
    }

    const [db, cache, behavioral] = await Promise.allSettled([
      checkPrismaHealth(),
      checkRedisHealth(),
      getBehavioralReport(),
    ]);

    const dbResult =
      db.status === "fulfilled"
        ? db.value
        : { status: "error", error: db.reason?.message };
    const cacheResult =
      cache.status === "fulfilled"
        ? cache.value
        : { status: "error", error: cache.reason?.message };
    const behavioralResult =
      behavioral.status === "fulfilled"
        ? behavioral.value
        : { error: "unavailable" };

    const allHealthy = dbResult.status === "ok" && cacheResult.status === "ok";
    const responseTime = Date.now() - startTime;

    logger.info(
      {
        health: allHealthy ? "healthy" : "degraded",
        database: dbResult.status,
        redis: cacheResult.status,
        queues: queueHealth,
        responseTimeMs: responseTime,
        suspiciousIps: behavioralResult.totalSuspicious || 0,
        blockedIps: behavioralResult.totalBlocked || 0,
      },
      `Health check completed: ${allHealthy ? "OK" : "DEGRADED"}`,
    );

    res.status(allHealthy ? 200 : 503).json({
      status: allHealthy ? "ok" : "degraded",
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
      responseTimeMs: responseTime,
      version: process.env.npm_package_version ?? "unknown",
      services: { database: dbResult, cache: cacheResult, queues: queueHealth },
      security: {
        suspiciousIps: behavioralResult.totalSuspicious || 0,
        blockedIps: behavioralResult.totalBlocked || 0,
      },
    });
  });

  // Status endpoint with version info
  app.get("/api/status", (_req, res) => {
    logger.debug("Status endpoint called");
    res.status(200).json({
      status: "ok",
      app: "resqid-api",
      version: process.env.npm_package_version ?? "unknown",
      env: ENV.NODE_ENV,
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      pid: process.pid,
      memory: process.memoryUsage(),
      timestamp: new Date().toISOString(),
    });
  });
}

// Graceful shutdown handler
export async function gracefulShutdown(app) {
  logger.info("🛑 Graceful shutdown initiated...");

  try {
    const { stopAllWorkers } =
      await import("./modules/order_orchestrator/workers/index.js");
    const { closeQueues } =
      await import("./modules/order_orchestrator/queues/queue.manager.js");

    await stopAllWorkers();
    await closeQueues();
    logger.info("✅ Order orchestrator workers stopped");
  } catch (err) {
    logger.error({ error: err.message }, "Error stopping orchestrator workers");
  }

  // Close server
  if (app) {
    app.close(() => {
      logger.info("✅ HTTP server closed");
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
}
