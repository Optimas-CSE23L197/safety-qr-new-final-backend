// =============================================================================
// app.js — RESQID
// Express application factory — pure configuration, no server binding
// server.js handles binding, clustering, and process lifecycle
//
// Middleware stack order is INTENTIONAL — do not reorder without understanding
// the security implications of each layer's position.
//
// Order rationale:
//   1. Trust proxy         — must be first, affects req.ip everywhere
//   2. Request ID          — must be before any logging
//   3. HTTP logger         — must be before any processing (log everything)
//   4. security headers    — before any response is sent
//   5. CORS                — before body parsing (preflight needs no body)
//   6. Body parsing        — before sanitization
//   7. Cookie parsing      — before CSRF
//   8. HPP                 — before sanitization (parameter normalization)
//   9. Sanitize/XSS        — before validation
//  10. Routes              — after all global middleware
//  11. 404 handler         — after all routes, before error handler
//  12. Error handler       — always last
//
// IMPORTANT — req.query / req.params assignment rule:
//   These properties are getter-only on Node's IncomingMessage. Any middleware
//   that needs to mutate them MUST use Object.assign(req.query, newValue)
//   instead of req.query = newValue. Direct reassignment throws a TypeError
//   at runtime. req.body is safe to reassign directly (set by express.json).
//   See: sanitize.middleware.js, xss.middleware.js
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
import {
  sanitizeNoSql,
  // rejectIfInjectionDetected,
  sanitizeDeep,
} from "./middleware/sanitize.middleware.js";
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

// ─── Routes ───────────────────────────────────────────────────────────────────
import router from "./routes/index.js";

// =============================================================================
// App Factory
// =============================================================================

export function createApp() {
  const app = express();

  // ── [1] Trust Proxy ─────────────────────────────────────────────────────────
  // MUST be set before anything reads req.ip
  // Value = number of proxy hops between client and this server
  // 1 = behind Nginx/Cloudflare (most common)
  // false = direct connection (development without proxy)
  // Incorrect setting = wrong IPs in logs, rate limiting, geo blocking
  app.set("trust proxy", ENV.TRUST_PROXY);

  // ── [2] Disable fingerprinting ───────────────────────────────────────────────
  app.disable("x-powered-by"); // belt-and-suspenders (helmet also does this)
  app.disable("etag"); // prevent information leakage via ETag headers

  // ── [3] Maintenance Mode ─────────────────────────────────────────────────────
  // Must be before everything — returns 503 immediately if enabled
  // /health, /api/health, /api/status are always exempt
  app.use(maintenanceMode);

  // ── [4] Request ID ───────────────────────────────────────────────────────────
  // Must be before HTTP logger — logger uses req.id
  // Assigned here, echoed in all response headers, used in all error responses
  app.use(requestId);

  // ── [5] HTTP Logger ──────────────────────────────────────────────────────────
  // Before security headers so we log all requests including blocked ones
  // Attaches req.log (child logger with requestId + ip context)
  app.use(httpLogger);

  // ── [6] security Headers (Helmet) ────────────────────────────────────────────
  // Applied globally — route-specific helmet policies are applied in routes
  // apiHelmet is the default (no CSP — API returns JSON)
  app.use(helmetMiddleware);

  // ── [6b] Permissions-Policy ──────────────────────────────────────────────────
  // Helmet v8 removed built-in permissionsPolicy support entirely.
  // Set manually as a response header so it appears on every API response.
  // Format: feature=() means "deny all origins" per Permissions Policy spec.
  app.use((_req, res, next) => {
    res.setHeader(
      "Permissions-Policy",
      "geolocation=(), microphone=(), camera=(), payment=(), usb=(), fullscreen=()",
    );
    next();
  });

  // ── [6c] IP Block ────────────────────────────────────────────────────────────
  // Rejects IPs flagged by attackLogger or geoBlock — Redis O(1) fast path
  // Must be BEFORE body parsing — reject blocked IPs before any processing
  app.use(ipBlockMiddleware);

  // ── [7] CORS ─────────────────────────────────────────────────────────────────
  // Global policy — most permissive (mobile + dashboard origins)
  // Route-specific policies (publicCors, dashboardCors) override in routes
  // handleCorsError must immediately follow cors() to catch origin violations
  app.use(corsMiddleware);
  app.use(handleCorsError);

  // ── [8] Health + Readiness Endpoints ─────────────────────────────────────────
  // Registered BEFORE body parsing — these must never fail
  // Used by: load balancers, Docker healthcheck, k8s liveness/readiness probes
  registerHealthEndpoints(app);

  // ── [9] Request Size Limits ───────────────────────────────────────────────────
  // Enforce Content-Length BEFORE body parsing to reject oversized requests
  // early — avoids loading the entire body into memory just to reject it
  app.use(enforceRequestSize);

  // ── [10] Content-Type Enforcement ────────────────────────────────────────────
  // Reject non-JSON Content-Type on mutation endpoints before body parsing
  // Prevents sanitize/XSS bypass via multipart or text/plain tricks
  app.use(enforceContentType);

  // ── [11] Body Parsing ────────────────────────────────────────────────────────
  // JSON only — no urlencoded (API, not form-based)
  // Limit here is a backstop — requestSize middleware is the primary guard
  app.use(
    express.json({
      limit: "20kb", // backstop limit
      strict: true, // reject non-object/array JSON (prevents primitive injection)
      type: ["application/json", "application/vnd.api+json"],
    }),
  );

  // ── [12] Cookie Parser ───────────────────────────────────────────────────────
  // After body parsing — cookies needed for CSRF verification
  // No secret needed here — CSRF uses its own HMAC verification
  app.use(cookieParser());

  // ── [13] HTTP Parameter Pollution ────────────────────────────────────────────
  // After body/query parsing — normalizes duplicate query params
  // ?role=PARENT&role=SUPER_ADMIN → takes first value only
  app.use(hppProtection);

  // ── [14] NoSQL Injection Sanitization ────────────────────────────────────────
  // Strips $ and . from keys — prevents Prisma raw query injection
  // Must run before sanitizeDeep (which checks for cleaned values)
  // app.use(sanitizeNoSql);
  // app.use(rejectIfInjectionDetected);

  // ── [15] Deep Object Sanitization ────────────────────────────────────────────
  // Prototype pollution, nesting depth, oversized string fields
  // Uses Object.assign for req.query and req.params (getter-only properties)
  app.use(sanitizeDeep);

  // ── [15b] Attack Logger ─────────────────────────────────────────────────────
  // MUST run here — AFTER sanitizeDeep (prototype pollution already blocked)
  //                  BEFORE sanitizeXss — script tags still exist in body here
  // If moved after sanitizeXss, <script> tags are already stripped and
  // scanForAttacks() finds nothing → AuditLog never written.
  // Detection only — always calls next(), never blocks the request.
  app.use(attackLogger);

  // ── [16] XSS Sanitization ────────────────────────────────────────────────────
  // Strip all HTML tags from string fields
  // Runs after NoSQL sanitize — operates on already-normalized input
  //
  // FIX [#11]: req.query and req.params cannot be directly reassigned —
  // they are getter-only on IncomingMessage. xss.middleware.js uses
  // Object.assign() to mutate them in-place. req.body remains a direct
  // reassignment as it is a plain writable property added by express.json().
  app.use(sanitizeXss);

  // ── [17] API Version ─────────────────────────────────────────────────────────
  // Reads version from URL prefix or API-Version header
  // Sets req.apiVersion for downstream use
  app.use(apiVersion);

  // ── [18] Compression ─────────────────────────────────────────────────────────
  // After security middleware, before routes
  // Compress JSON responses — significant bandwidth saving for paginated data
  // Skip compression for small responses (< 1kb) — overhead not worth it
  app.use(
    compression({
      level: 6, // balance between CPU and compression ratio
      threshold: 1024, // only compress responses > 1KB
      filter: (req, res) => {
        // Never compress if client explicitly says no
        if (req.headers["x-no-compression"]) return false;
        return compression.filter(req, res);
      },
    }),
  );

  // ── [19] Application Routes ───────────────────────────────────────────────────
  // All routes under /api — versioned, role-scoped, fully middlewarized
  app.use("/api", router);

  // ── [20] 404 Handler ─────────────────────────────────────────────────────────
  // After all routes — catches any unmatched route
  // Must be before globalErrorHandler
  app.use(notFoundHandler);

  // ── [21] Global Error Handler ────────────────────────────────────────────────
  // MUST be last — Express identifies error middleware by 4-arg signature
  // Handles: ApiError, ZodError, Prisma errors, JWT errors, unknown errors
  app.use(globalErrorHandler);

  logger.info(
    {
      type: "app_created",
      env: ENV.NODE_ENV,
      trustProxy: ENV.TRUST_PROXY,
    },
    "Express app created",
  );

  return app;
}

// =============================================================================
// Health + Readiness Endpoints
// =============================================================================
// Registered directly on app (not through router) so they:
//   - Are never affected by auth middleware
//   - Never trigger rate limiting
//   - Never fail due to maintenance mode (maintenanceMode always exempts /health)
//   - Respond even if DB/Redis is down (liveness vs readiness distinction)

function registerHealthEndpoints(app) {
  // ── Liveness probe ───────────────────────────────────────────────────────────
  // "Is the process alive?" — if this fails, restart the container
  // Never checks external dependencies — just confirms process is running
  app.get("/health", (_req, res) => {
    res.status(200).json({
      status: "ok",
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      env: ENV.NODE_ENV,
    });
  });

  // ── Readiness probe ──────────────────────────────────────────────────────────
  // "Is the app ready to serve traffic?" — checks all critical dependencies
  // If this fails, remove from load balancer rotation but don't restart
  app.get("/api/health", async (_req, res) => {
    const { checkPrismaHealth } = await import("./config/prisma.js");
    const { checkRedisHealth } = await import("./config/redis.js");

    const [db, cache] = await Promise.allSettled([
      checkPrismaHealth(),
      checkRedisHealth(),
    ]);

    const dbResult =
      db.status === "fulfilled"
        ? db.value
        : { status: "error", error: db.reason?.message };
    const cacheResult =
      cache.status === "fulfilled"
        ? cache.value
        : { status: "error", error: cache.reason?.message };

    const allHealthy = dbResult.status === "ok" && cacheResult.status === "ok";

    res.status(allHealthy ? 200 : 503).json({
      status: allHealthy ? "ok" : "degraded",
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
      version: process.env.npm_package_version ?? "unknown",
      services: {
        database: dbResult,
        cache: cacheResult,
      },
    });
  });

  // ── Status endpoint ──────────────────────────────────────────────────────────
  // Lightweight version info — for ops dashboards, no dependency checks
  app.get("/api/status", (_req, res) => {
    res.status(200).json({
      status: "ok",
      app: "resqid-api",
      version: process.env.npm_package_version ?? "unknown",
      env: ENV.NODE_ENV,
      nodeVersion: process.version,
      timestamp: new Date().toISOString(),
    });
  });
}
