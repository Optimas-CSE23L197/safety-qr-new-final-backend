// =============================================================================
// xss.middleware.js — RESQID
// XSS prevention — sanitize all string fields in request
// Uses DOMPurify-compatible server-side approach with xss library
// Runs AFTER sanitize.middleware.js, BEFORE validate.middleware.js
// =============================================================================

import xss from "xss";
import { asyncHandler } from "../utils/Response/asyncHandler.js";

// ─── XSS Config ───────────────────────────────────────────────────────────────
// Strict — no HTML tags allowed in any API field
// Emergency profile fields (allergies, conditions) are plain text only

const xssOptions = {
  whiteList: {}, // No tags allowed at all
  stripIgnoreTag: true, // Strip disallowed tags
  stripIgnoreTagBody: ["script", "style", "iframe", "form", "object"],
  escapeHtml: (str) =>
    str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#x27;"),
};

// ─── Fields Exempt from XSS (pre-encrypted — raw bytes) ──────────────────────
const ENCRYPTED_FIELDS = new Set([
  "dob_encrypted",
  "phone_encrypted",
  "doctor_phone_encrypted",
  "password_hash",
  "otp_hash",
  "token_hash",
]);

// ─── Middleware ───────────────────────────────────────────────────────────────

/**
 * sanitizeXss
 * Recursively strips XSS from all string fields in body/query/params
 * Encrypted fields are skipped — they're binary-safe already
 */
export const sanitizeXss = asyncHandler(async (req, _res, next) => {
  if (req.body) req.body = xssClean(req.body);
  if (req.query) req.query = xssClean(req.query);
  if (req.params) req.params = xssClean(req.params);
  next();
});

// FIX [#10]: Removed unused `i` index parameter from the array map callback.
// The parent `key` is correctly passed down so ENCRYPTED_FIELDS checks work —
// the index was never used and only caused a lint warning.
function xssClean(data, key = null) {
  if (typeof data === "string") {
    // Skip encrypted fields — never XSS clean raw encrypted values
    if (ENCRYPTED_FIELDS.has(key)) return data;
    return xss(data, xssOptions);
  }

  if (Array.isArray(data)) {
    return data.map((item) => xssClean(item, key));
  }

  if (data !== null && typeof data === "object") {
    const clean = {};
    for (const [k, v] of Object.entries(data)) {
      clean[k] = xssClean(v, k);
    }
    return clean;
  }

  return data;
}
