// =============================================================================
// contentType.middleware.js — RESQID
// Enforces Content-Type: application/json on all mutating requests
// Rejects before body parsing — prevents bypass of sanitize + XSS middleware
//
// Why this matters:
//   Without content-type enforcement, a request with Content-Type: text/plain
//   or no content-type at all can reach route handlers. Express's body parser
//   may not parse the body at all in these cases, meaning sanitize.middleware
//   and xss.middleware see an empty req.body and pass through silently.
//   Attackers can sometimes use this to bypass input validation entirely.
//
// Exceptions:
//   - GET, HEAD, OPTIONS, DELETE — no body expected
//   - Multipart (file uploads) — handled separately via multer
//   - /api/emergency — public GET endpoint, no body
//   - /api/webhooks/razorpay — Razorpay sends application/json but we
//     whitelist explicitly since they sign the raw body
// =============================================================================

import { ApiError } from "../utils/Response/ApiError.js";
import { asyncHandler } from "../utils/Response/asyncHandler.js";

// Methods that MUST send application/json body
const REQUIRES_JSON = new Set(["POST", "PUT", "PATCH"]);

// Methods where a body is optional but if present must be JSON
const OPTIONAL_JSON = new Set(["DELETE"]);

// Routes exempt from content-type check
const EXEMPT_PREFIXES = [
  "/api/emergency", // public GET — no body
  "/api/webhooks", // webhooks from external providers — raw body needed
  "/health",
  "/api/health",
];

// Routes that accept multipart/form-data (file uploads)
const MULTIPART_PREFIXES = [
  "/api/school-admin/students/photo",
  "/api/school-admin/template/logo",
  "/api/super-admin/schools/logo",
];

// ─── Core Middleware ──────────────────────────────────────────────────────────

/**
 * enforceContentType
 * Runs BEFORE body parsing middleware in app.js
 * Rejects requests with wrong or missing Content-Type immediately
 */
export const enforceContentType = asyncHandler(async (req, _res, next) => {
  // Skip methods that don't send a body
  if (!REQUIRES_JSON.has(req.method) && !OPTIONAL_JSON.has(req.method)) {
    return next();
  }

  // Skip exempt routes
  if (EXEMPT_PREFIXES.some((p) => req.path.startsWith(p))) return next();

  // Skip multipart routes — they use their own content-type
  if (MULTIPART_PREFIXES.some((p) => req.path.startsWith(p))) return next();

  // DELETE with no body is fine — skip if content-length is 0 or absent
  if (OPTIONAL_JSON.has(req.method)) {
    const contentLength = parseInt(req.headers["content-length"] ?? "0", 10);
    const hasBody = contentLength > 0 || req.headers["transfer-encoding"];
    if (!hasBody) return next();
  }

  const contentType = req.headers["content-type"] ?? "";

  // Must include application/json (may have charset suffix e.g. "; charset=utf-8")
  if (!contentType.toLowerCase().includes("application/json")) {
    throw ApiError.badRequest(
      `Content-Type must be application/json — received: '${contentType || "none"}'`,
    );
  }

  next();
});
