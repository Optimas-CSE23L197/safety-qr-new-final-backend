// =============================================================================
// cors.middleware.js — RESQID
// Strict origin allowlist — unknown origin = hard block, no wildcards ever
// Public emergency endpoint has its own CORS policy (no credentials allowed)
// =============================================================================

import cors from "cors";
import { ENV } from "../config/env.js";

// ─── Allowed Origins ──────────────────────────────────────────────────────────

const DASHBOARD_ORIGINS = new Set(
  [
    ENV.SUPER_ADMIN_URL, // e.g. https://admin.resqid.in
    ENV.SCHOOL_ADMIN_URL, // e.g. https://app.resqid.in
    ...(ENV.NODE_ENV === "development"
      ? ["http://localhost:3000", "http://localhost:5173"]
      : []),
  ].filter(Boolean),
); // FIX [#8]: filter removes undefined if env vars are unset

// FIX [#8]: filter(Boolean) prevents undefined from being stored in the Set,
// which would never match any real origin but pollutes the collection.
const MOBILE_APP_ORIGINS = new Set(
  [
    "capacitor://localhost", // Ionic Capacitor iOS/Android
    "http://localhost", // local dev
    ENV.MOBILE_APP_SCHEME, // custom deep link scheme if any
  ].filter(Boolean),
);

// ─── CORS Factory ─────────────────────────────────────────────────────────────

function buildCors(allowedOrigins, { credentials = true } = {}) {
  return cors({
    origin(origin, callback) {
      // Allow requests with no origin (server-to-server, curl in dev)
      if (!origin) {
        if (ENV.NODE_ENV === "production") {
          return callback(new Error("Origin required in production"));
        }
        return callback(null, true);
      }

      if (allowedOrigins.has(origin)) {
        return callback(null, true);
      }

      // Unknown origin — hard block, log for monitoring
      return callback(new Error(`CORS: origin '${origin}' not allowed`));
    },
    credentials,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Request-ID",
      "X-CSRF-Token",
    ],
    exposedHeaders: [
      "X-Request-ID",
      "X-RateLimit-Remaining",
      "X-RateLimit-Reset",
    ],
    maxAge: 600, // 10 min preflight cache
    optionsSuccessStatus: 204,
  });
}

// ─── Exported Policies ────────────────────────────────────────────────────────

/**
 * dashboardCors — for /api/super-admin and /api/school-admin routes
 * Full credentials, strict origin
 */
export const dashboardCors = buildCors(DASHBOARD_ORIGINS, {
  credentials: true,
});

/**
 * mobileCors — for /api/auth and /api/parents routes
 * Allows mobile app origins
 */
export const mobileCors = buildCors(
  new Set([...DASHBOARD_ORIGINS, ...MOBILE_APP_ORIGINS]),
  { credentials: true },
);

/**
 * publicCors — for /api/emergency (public QR scan endpoint)
 * No credentials, wide origin — any phone camera browser can hit this
 * credentials: false is critical — prevents cookie/session leakage
 */
export const publicCors = cors({
  origin: "*", // public endpoint — any origin allowed
  credentials: false, // MUST be false when origin: '*'
  methods: ["GET", "OPTIONS"],
  allowedHeaders: ["Content-Type", "X-Request-ID"],
  maxAge: 300,
  optionsSuccessStatus: 204,
});

/**
 * Default export — applied globally in app.js
 * Uses most permissive policy; route-level policies override as needed
 */
export const corsMiddleware = mobileCors;

/**
 * handleCorsError — must be registered after cors() to catch origin errors
 */
export function handleCorsError(err, req, res, next) {
  if (
    err.message?.startsWith("CORS:") ||
    err.message === "Origin required in production"
  ) {
    return res.status(403).json({
      success: false,
      message: "CORS policy violation",
      requestId: req.id,
    });
  }
  next(err);
}
