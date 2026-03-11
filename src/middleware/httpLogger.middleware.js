// =============================================================================
// httpLogger.middleware.js — RESQID
// Structured HTTP request/response logging via Pino
// - Every request gets a unique log entry with timing
// - Sensitive fields are NEVER logged (Authorization, passwords, OTPs)
// - Public emergency API scans get enriched logging (scan audit trail)
// - Error responses are logged at WARN/ERROR level automatically
//
// FIX [#9]: req.log child logger is created before authenticate runs, so
// userId/role are always undefined at creation time. We now attach a lazy
// getter to req.log so that response-finish logging picks up the userId and
// role that authenticate later populates on req.
// =============================================================================

import { logger } from "../config/logger.js";
import { extractIp } from "../utils/network/extractIp.js";

// ─── Fields to NEVER log — security critical ─────────────────────────────────
const REDACTED = "[REDACTED]";

const SENSITIVE_HEADERS = new Set([
  "authorization",
  "cookie",
  "x-csrf-token",
  "x-api-key",
  "proxy-authorization",
]);

const SENSITIVE_BODY_KEYS = new Set([
  "password",
  "password_hash",
  "otp",
  "otp_hash",
  "token",
  "token_hash",
  "refresh_token",
  "secret",
  "private_key",
  "credit_card",
  "cvv",
]);

// ─── Routes with elevated logging (full body capture) ─────────────────────────
const ELEVATED_LOG_ROUTES = new Set([
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/refresh",
]);

// ─── Core Logger Middleware ───────────────────────────────────────────────────

export function httpLogger(req, res, next) {
  const startAt = process.hrtime.bigint();
  const reqId = req.id ?? req.requestId;
  const ip = extractIp(req);

  // FIX [#9]: Rather than creating a static child logger once (which captures
  // userId/role as undefined before authenticate runs), we create the initial
  // child for the inbound log and then rebuild it on response-finish so it
  // carries the userId/role that authenticate set on req during the request.
  const baseChild = logger.child({
    requestId: reqId,
    ip,
  });

  // Attach to req — downstream middleware can call req.log.warn() etc.
  // This logger is accurate for the inbound side (before auth).
  req.log = baseChild;

  // Log incoming request
  req.log.info(
    {
      type: "request",
      method: req.method,
      url: sanitizeUrl(req.originalUrl),
      headers: sanitizeHeaders(req.headers),
      // Only log body on elevated routes AND only if not too large
      ...(shouldLogBody(req) && { body: sanitizeBody(req.body) }),
    },
    `→ ${req.method} ${req.path}`,
  );

  // Intercept response finish to log outgoing
  // By this point authenticate has run, so req.userId and req.role are set.
  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startAt) / 1_000_000;
    const level = resolveLogLevel(res.statusCode);

    // FIX [#9]: Rebuild child with auth context now that it's available.
    // This ensures the response log line carries the authenticated user.
    const responseLog = logger.child({
      requestId: reqId,
      ip,
      userId: req.userId ?? undefined,
      role: req.role ?? undefined,
    });

    responseLog[level](
      {
        type: "response",
        method: req.method,
        url: sanitizeUrl(req.originalUrl),
        statusCode: res.statusCode,
        durationMs: Math.round(durationMs * 100) / 100,
        contentLen: res.getHeader("content-length") ?? 0,
        userId: req.userId ?? undefined,
        schoolId: req.schoolId ?? undefined,
        // Scan-specific enrichment for audit trail
        ...(isEmergencyRoute(req) && {
          scanAudit: {
            tokenHash: req.params?.token,
            scanIp: ip,
            userAgent: req.headers["user-agent"],
          },
        }),
      },
      `← ${res.statusCode} ${req.method} ${req.path} ${Math.round(durationMs)}ms`,
    );
  });

  res.on("error", (err) => {
    req.log.error({ type: "response_error", err }, "Response stream error");
  });

  next();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolveLogLevel(statusCode) {
  if (statusCode >= 500) return "error";
  if (statusCode >= 400) return "warn";
  return "info";
}

function sanitizeHeaders(headers) {
  const safe = {};
  for (const [key, value] of Object.entries(headers)) {
    safe[key] = SENSITIVE_HEADERS.has(key.toLowerCase()) ? REDACTED : value;
  }
  return safe;
}

function sanitizeBody(body) {
  if (!body || typeof body !== "object") return body;

  const safe = {};
  for (const [key, value] of Object.entries(body)) {
    if (SENSITIVE_BODY_KEYS.has(key.toLowerCase())) {
      safe[key] = REDACTED;
    } else if (typeof value === "object" && value !== null) {
      safe[key] = sanitizeBody(value);
    } else {
      safe[key] = value;
    }
  }
  return safe;
}

function sanitizeUrl(url) {
  // Strip potential sensitive query params from URL log
  try {
    const u = new URL(url, "http://localhost");
    for (const key of ["token", "key", "secret", "password"]) {
      if (u.searchParams.has(key)) u.searchParams.set(key, REDACTED);
    }
    return u.pathname + (u.search || "");
  } catch {
    return url;
  }
}

function shouldLogBody(req) {
  // Only log body on elevated routes
  if (!ELEVATED_LOG_ROUTES.has(req.path)) return false;
  // Never log if body is too large (file upload etc.)
  const contentLen = parseInt(req.headers["content-length"] ?? "0", 10);
  return contentLen < 10_000; // < 10KB only
}

function isEmergencyRoute(req) {
  return req.path.startsWith("/api/emergency");
}
