// =============================================================================
// requestSize.middleware.js — RESQID
// Per-route HTTP body size limits enforced at the HTTP layer
// Rejects oversized requests BEFORE body parsing — prevents memory pressure
//
// Why this matters:
//   Express's built-in json({ limit }) is a global limit. Without per-route
//   limits, a 10MB JSON payload sent to /api/auth/login is parsed in full
//   before any validation runs. On a constrained server, repeated large
//   payloads can cause memory exhaustion (OOM) and crash the process.
//   This middleware rejects based on Content-Length header before any
//   parsing happens — zero memory cost for rejected requests.
//
// Limits are intentionally strict per route type:
//   - Auth routes (OTP, login): 2KB — phone + device info only
//   - Parent profile updates: 50KB — allows base64 thumbnail previews
//   - Photo upload: 5MB — handled via multer separately, not here
//   - Emergency profile: 10KB — medical text fields only
//   - Admin routes: 100KB — bulk student import CSV metadata
//   - Default API: 20KB
//   - Public emergency (GET): 0 — no body allowed at all
// =============================================================================

import { ApiError } from '#utils/response/ApiError.js';
import { asyncHandler } from '#utils/response/asyncHandler.js';

// ─── Size Limit Definitions ───────────────────────────────────────────────────
// All in bytes

const SIZES = {
  KB: n => n * 1024,
  MB: n => n * 1024 * 1024,
};

// Route prefix → max body size in bytes
// Checked in order — first match wins
const ROUTE_LIMITS = [
  // Auth — tiny payloads only
  { prefix: '/api/auth/otp', limit: SIZES.KB(2) },
  { prefix: '/api/auth/login', limit: SIZES.KB(2) },
  { prefix: '/api/auth/refresh', limit: SIZES.KB(1) },
  { prefix: '/api/auth', limit: SIZES.KB(5) },

  // Emergency profile — medical text, no binary
  { prefix: '/api/parents/emergency', limit: SIZES.KB(10) },
  { prefix: '/api/parents/contacts', limit: SIZES.KB(10) },

  // Parent app — general profile updates
  { prefix: '/api/parents', limit: SIZES.KB(50) },

  // Public emergency endpoint — GET only, no body
  { prefix: '/api/emergency', limit: 0 },

  // School admin — bulk student imports can be larger
  { prefix: '/api/school-admin/students/bulk', limit: SIZES.KB(500) },
  { prefix: '/api/school-admin', limit: SIZES.KB(100) },

  // Super admin — platform management
  { prefix: '/api/super-admin', limit: SIZES.KB(200) },

  // Webhook — raw body from Razorpay, allow up to 50KB
  { prefix: '/api/webhooks', limit: SIZES.KB(50) },

  // Default
  { prefix: '/', limit: SIZES.KB(20) },
];

// ─── Core Middleware ──────────────────────────────────────────────────────────

/**
 * enforceRequestSize
 * Checks Content-Length header against per-route limit.
 * Register BEFORE express.json() in app.js.
 *
 * Note: Content-Length can be spoofed but this is a first-line defense.
 * Express's json({ limit }) acts as the second line if Content-Length is absent
 * or wrong (chunked transfer encoding).
 */
export const enforceRequestSize = asyncHandler(async (req, _res, next) => {
  // GET, HEAD, OPTIONS have no body
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

  const contentLength = req.headers['content-length'];

  // No Content-Length header — chunked transfer or empty body
  // Let Express's json() limit handle it — skip here
  if (!contentLength) return next();

  const bodySize = parseInt(contentLength, 10);
  if (isNaN(bodySize)) return next();

  const limit = resolveLimit(req.path);

  // Route explicitly has 0 limit — no body allowed
  if (limit === 0 && bodySize > 0) {
    throw ApiError.badRequest('Request body not allowed on this endpoint');
  }

  if (bodySize > limit) {
    throw ApiError.create(
      413,
      `Request body too large — max ${formatBytes(limit)} allowed, received ${formatBytes(bodySize)}`
    );
  }

  next();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolveLimit(path) {
  for (const { prefix, limit } of ROUTE_LIMITS) {
    if (path.startsWith(prefix)) return limit;
  }
  return SIZES.KB(20); // fallback default
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 bytes';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
