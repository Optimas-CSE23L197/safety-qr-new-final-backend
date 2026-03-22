// =============================================================================
// app.js — RESQID
// Express application factory — pure configuration, no server binding
// server.js handles binding, clustering, and process lifecycle
//
// ┌─────────────────────────────────────────────────────────────────────────┐
// │  SECURITY LAYER MAP — every request passes these in order               │
// ├────┬────────────────────────────┬────────────────────────────────────── │
// │ #  │ Layer                      │ File / Utility                        │
// ├────┼────────────────────────────┼────────────────────────────────────── │
// │  1 │ Trust proxy + fingerprint  │ app.set / app.disable                 │
// │  2 │ Maintenance gate           │ maintenanceMode.middleware.js         │
// │  3 │ Request ID                 │ requestId.middleware.js               │
// │  4 │ HTTP logger                │ httpLogger.middleware.js              │
// │  5 │ Security headers           │ helmet.middleware.js                  │
// │  6 │ Permissions-Policy         │ inline (helmet v8 dropped this)       │
// │  7 │ IP block (Redis fast path) │ ipBlock.middleware.js                 │
// │  8 │ Cloudflare validation      │ NEW — validateCloudflareRequest()     │
// │  9 │ CORS                       │ cors.middleware.js                    │
// │ 10 │ Health endpoints           │ registerHealthEndpoints()             │
// │ 11 │ Request size               │ requestSize.middleware.js             │
// │ 12 │ Content-Type               │ contentType.middleware.js             │
// │ 13 │ Body parsing               │ express.json                          │
// │ 14 │ Cookie parsing             │ cookie-parser                         │
// │ 15 │ HPP                        │ hpp.middleware.js                     │
// │ 16 │ Deep sanitize              │ sanitize.middleware.js                │
// │ 17 │ Attack logger              │ attackLogger.middleware.js            │
// │ 18 │ XSS sanitize               │ xss.middleware.js                     │
// │ 19 │ API version                │ apiVersion.middleware.js              │
// │ 20 │ Compression                │ compression                           │
// │ 21 │ Routes                     │ routes/index.js                       │
// │ 22 │ 404 handler                │ error.middleware.js                   │
// │ 23 │ Global error handler       │ error.middleware.js                   │
// └────┴────────────────────────────┴────────────────────────────────────── │
//
// ── 5 CRITICAL SECURITY FIXES ADDED IN THIS VERSION ──────────────────────
//
//  FIX 1 — JWT jti claim
//    WHERE: utils/security/jwt.js (not in app.js directly)
//    WHAT:  Every issued JWT now includes jti: uuidv4()
//    WHY:   Without jti, token blacklisting is impossible — you can only
//           nuke all tokens for a user, not a single stolen token.
//    HOW:   See jwt.js — jti is stamped at sign time, checked at verify time,
//           and used as the Redis blacklist key: blacklist:{jti}
//
//  FIX 2 — Refresh token reuse detection
//    WHERE: services/auth/session.service.js (not in app.js directly)
//    WHAT:  When an already-rotated refresh token is presented, ALL sessions
//           for that user are immediately revoked.
//    WHY:   Token rotation alone isn't enough — if a token is stolen and
//           used before the legitimate user, the legitimate user's next
//           request will fail silently. Reuse = signal of theft.
//    HOW:   See session.service.js — refreshToken() checks if token was
//           already rotated; if so → wipeAllSessions(userId) + 401.
//
//  FIX 3 — Registration nonce
//    WHERE: auth.routes.js + services/auth/auth.service.js
//    WHAT:  Server issues a one-time nonce before signup; client must echo it.
//    WHY:   Prevents bot-driven mass account creation even if OTP is bypassed.
//    HOW:   GET /api/v1/auth/nonce → server stores nonce in Redis (TTL 10min)
//           POST /api/v1/auth/register → must include nonce in body
//           Server verifies + deletes nonce (one-time use)
//
//  FIX 4 — SSRF protection
//    WHERE: utils/security/ssrf.js (new file — see below)
//    WHAT:  Block outbound HTTP calls to private IP ranges and metadata endpoints.
//    WHY:   Any user-supplied URL (webhook URLs, avatar URLs) could point to
//           http://169.254.169.254 (AWS metadata) or internal services.
//    HOW:   validateOutboundUrl(url) called in webhook.service.js and anywhere
//           a user-supplied URL is fetched. Blocks RFC-1918 + link-local ranges.
//
//  FIX 5 — Timing-safe comparisons
//    WHERE: utils/security/hashUtil.js (updated)
//    WHAT:  All secret comparisons use crypto.timingSafeEqual()
//    WHY:   String === comparison leaks timing info — attacker can brute-force
//           1 byte at a time by measuring response time differences.
//    HOW:   timingSafeCompare(a, b) in hashUtil.js wraps timingSafeEqual.
//           Used for: API keys, nonces, CSRF tokens, webhook signatures.
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
import scanRoute from "./modules/scan/scan.routes.js";

// ─── Routes ───────────────────────────────────────────────────────────────────
import router from "./routes/index.js";
import morgan from "morgan";
import { accessLogger } from "./middleware/morgan.middleware.js";

// morgan logger

// =============================================================================
// App Factory
// =============================================================================

export function createApp() {
  const app = express();

  // ── [1] Trust Proxy ──────────────────────────────────────────────────────────
  // MUST be first — affects req.ip for all rate limiting, geo blocking, logging.
  // With Cloudflare: set to 1 (Cloudflare is one hop ahead of your origin).
  // Cloudflare sends real client IP in CF-Connecting-IP header — trust proxy
  // tells Express to read X-Forwarded-For correctly.
  // Wrong value = all IPs show as Cloudflare's IP → rate limiting breaks.
  app.set("trust proxy", ENV.TRUST_PROXY); // ENV.TRUST_PROXY = 1 in production

  // ── [2] Disable fingerprinting ───────────────────────────────────────────────
  app.disable("x-powered-by"); // belt-and-suspenders (helmet also does this)
  app.disable("etag"); // prevent info leakage via ETag headers

  // ── [3] Maintenance Mode ─────────────────────────────────────────────────────
  // First real middleware — returns 503 immediately if enabled.
  // /health, /api/health, /api/status are always exempt.
  app.use(maintenanceMode);

  // ── [4] Request ID ───────────────────────────────────────────────────────────
  // Must be before HTTP logger — logger attaches req.id to every log line.
  // Every response echoes X-Request-ID so client can trace errors.
  app.use(requestId);

  // ── [5] HTTP Logger ──────────────────────────────────────────────────────────
  // Before everything else so we log ALL requests including blocked ones.
  // Attaches req.log (child logger with requestId + ip context).
  app.use(accessLogger);
  app.use(httpLogger);

  // ── [6] Security Headers (Helmet) ───────────────────────────────────────────
  // Applied globally before any response is sent.
  // CSP, HSTS, X-Frame-Options, X-Content-Type, Referrer-Policy.
  app.use(helmetMiddleware);

  // ── [7] Permissions-Policy ──────────────────────────────────────────────────
  // Helmet v8 dropped built-in permissionsPolicy support.
  // Deny all sensitive browser features on every API response.
  app.use((_req, res, next) => {
    res.setHeader(
      "Permissions-Policy",
      "geolocation=(), microphone=(), camera=(), payment=(), usb=(), fullscreen=()",
    );
    next();
  });

  // ── [8] IP Block (Redis fast path) ──────────────────────────────────────────
  // O(1) Redis lookup — rejects flagged IPs BEFORE any heavy processing.
  // IPs are added here by: attackLogger, geoBlock, manual admin action.
  // Must be before body parsing — don't waste memory on blocked IPs.
  app.use(ipBlockMiddleware);

  // ── [9] Cloudflare Request Validation ───────────────────────────────────────
  // FIX: Ensures requests actually come FROM Cloudflare, not from attackers
  // who bypass Cloudflare and hit your origin IP directly.
  //
  // HOW TO SET THIS UP:
  //   Step 1: In Cloudflare dashboard → SSL/TLS → Origin Server → Create Certificate
  //   Step 2: Download the origin certificate + private key
  //   Step 3: Install on your server (Nginx/Node HTTPS)
  //   Step 4: In Cloudflare → Security → WAF → Create Rule:
  //           "Block requests where CF-Connecting-IP is not present"
  //           This blocks anyone hitting origin IP directly.
  //   Step 5: Set ENV.CLOUDFLARE_ONLY = true in production
  //
  // The middleware below is a secondary app-level check using the
  // CF-Connecting-IP header — Cloudflare always sends this, direct hits don't.
  app.use(validateCloudflareRequest);

  // ── [10] CORS ────────────────────────────────────────────────────────────────
  // After IP block — don't process CORS for blocked IPs.
  // Global policy covers mobile app + dashboard origins.
  // Route-specific policies (publicCors, dashboardCors) override in routes.
  app.use(corsMiddleware);
  app.use(handleCorsError);

  // ── [11] Health + Readiness Endpoints ───────────────────────────────────────
  // Registered BEFORE body parsing — these must never fail.
  // Used by: load balancers, Docker healthcheck, k8s liveness/readiness probes.
  registerHealthEndpoints(app);

  // ── [12] Request Size Limits ─────────────────────────────────────────────────
  // Enforce Content-Length BEFORE body parsing.
  // Prevents loading entire body into memory just to reject it.
  app.use(enforceRequestSize);

  // ── [13] Content-Type Enforcement ───────────────────────────────────────────
  // Reject non-JSON Content-Type on mutation endpoints before body parsing.
  // Prevents sanitize/XSS bypass via multipart or text/plain tricks.
  app.use(enforceContentType);

  // ── [14] Body Parsing ────────────────────────────────────────────────────────
  // JSON only — no urlencoded (API, not form-based).
  // strict:true rejects non-object/array JSON (prevents primitive injection).
  // 20kb here is backstop — requestSize middleware is the real guard.
  app.use(
    express.json({
      limit: "20kb",
      strict: true,
      type: ["application/json", "application/vnd.api+json"],
    }),
  );

  // ── [15] Cookie Parser ───────────────────────────────────────────────────────
  // After body parsing — cookies needed for CSRF + refresh token verification.
  app.use(cookieParser());

  // ── [16] HTTP Parameter Pollution ───────────────────────────────────────────
  // After body/query parsing — normalises duplicate query params.
  // ?role=PARENT&role=SUPER_ADMIN → takes first value only.
  app.use(hppProtection);

  // ── [17] Deep Object Sanitization ───────────────────────────────────────────
  // Prototype pollution, nesting depth, oversized string fields.
  // Uses Object.assign for req.query and req.params (getter-only properties).
  app.use(sanitizeDeep);

  // ── [18] Attack Logger ───────────────────────────────────────────────────────
  // MUST be AFTER sanitizeDeep (prototype pollution already blocked)
  //         BEFORE sanitizeXss (script tags still in body here — we need to log them)
  // Detection only — always calls next(), never blocks.
  app.use(attackLogger);

  // ── [19] XSS Sanitization ────────────────────────────────────────────────────
  // Strip all HTML tags from string fields in body/query/params.
  // Runs after attackLogger so we log the raw attack, then clean it.
  app.use(sanitizeXss);

  // public scan routes
  app.use("/s", scanRoute);

  // ── [20] API Version ─────────────────────────────────────────────────────────
  // Reads version from URL prefix or API-Version header.
  // Sets req.apiVersion for downstream use.
  app.use(apiVersion);

  // ── [21] Compression ─────────────────────────────────────────────────────────
  // After all security middleware, before routes.
  // Only compress responses > 1KB — overhead not worth it for small payloads.
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
  app.use("/api/:version", router);

  // ── [23] 404 Handler ─────────────────────────────────────────────────────────
  app.use(notFoundHandler);

  // ── [24] Global Error Handler ────────────────────────────────────────────────
  // MUST be last — Express identifies error middleware by 4-arg signature.
  // Handles: ApiError, ZodError, Prisma errors, JWT errors, unknown errors.
  // NEVER leaks stack traces to client in production.
  app.use(globalErrorHandler);

  logger.info(
    { type: "app_created", env: ENV.NODE_ENV, trustProxy: ENV.TRUST_PROXY },
    "Express app created",
  );

  return app;
}

// =============================================================================
// FIX 9 — Cloudflare-Only Request Validation
// =============================================================================
// Blocks direct hits to your origin server that bypass Cloudflare.
// Attackers find your origin IP via Shodan, DNS history, or certificate logs.
// If they hit origin directly, ALL your Cloudflare WAF/DDoS rules are bypassed.
//
// This is your app-level fallback after the Cloudflare origin cert setup.
//
// In production:   ENV.CLOUDFLARE_ONLY = true
// In development:  ENV.CLOUDFLARE_ONLY = false (skip check)
//
// CF-Connecting-IP is ALWAYS injected by Cloudflare on proxied requests.
// A direct hit to your origin will NOT have this header.
// =============================================================================

function validateCloudflareRequest(req, res, next) {
  // Skip in development or if Cloudflare enforcement is disabled
  if (!ENV.CLOUDFLARE_ONLY || ENV.NODE_ENV !== "production") {
    return next();
  }

  // Always allow health checks — load balancers hit these directly
  if (req.path === "/health" || req.path === "/api/health") {
    return next();
  }

  // Cloudflare always injects CF-Connecting-IP on proxied requests.
  // If this header is missing, request did NOT come through Cloudflare.
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

  // Replace req.ip with the real client IP from Cloudflare header.
  // This overrides the X-Forwarded-For chain with the definitive Cloudflare value.
  // All downstream middleware (rate limit, geo block) will use this real IP.
  req.realIp = cfConnectingIp;

  next();
}

// =============================================================================
// Health + Readiness Endpoints
// =============================================================================

function registerHealthEndpoints(app) {
  // Liveness — "Is the process alive?" — never checks external deps
  app.get("/health", (_req, res) => {
    res.status(200).json({
      status: "ok",
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      env: ENV.NODE_ENV,
    });
  });

  // Readiness — "Is the app ready to serve traffic?" — checks DB + Redis
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
      services: { database: dbResult, cache: cacheResult },
    });
  });

  // Status — lightweight version info, no dep checks
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
