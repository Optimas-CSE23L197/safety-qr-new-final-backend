// =============================================================================
// xss.middleware.js — RESQID
// XSS prevention — sanitize all string fields in request
// Uses DOMPurify-compatible server-side approach with xss library
// Runs AFTER sanitize.middleware.js, BEFORE validate.middleware.js
//
// FIX [#11]: req.query and req.params are getter-only properties on
// IncomingMessage — direct assignment throws:
//   "Cannot set property query of #<IncomingMessage> which has only a getter"
// Fixed by using Object.assign() to mutate in-place, mirroring the same
// pattern already used in sanitize.middleware.js for the same reason.
// req.body is a plain writable property added by express.json(), so it
// can still be directly reassigned.
// =============================================================================

import xss from 'xss';
import { asyncHandler } from '#shared/response/asyncHandler.js';

// ─── XSS Config ───────────────────────────────────────────────────────────────
// Strict — no HTML tags allowed in any API field
// Emergency profile fields (allergies, conditions) are plain text only

const xssOptions = {
  whiteList: {}, // No tags allowed at all
  stripIgnoreTag: true, // Strip disallowed tags
  stripIgnoreTagBody: ['script', 'style', 'iframe', 'form', 'object'],
  escapeHtml: str =>
    str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;'),
};

// ─── Fields Exempt from XSS (pre-encrypted — raw bytes) ──────────────────────
const ENCRYPTED_FIELDS = new Set([
  'dob_encrypted',
  'phone_encrypted',
  'doctor_phone_encrypted',
  'password_hash',
  'otp_hash',
  'token_hash',
]);

// ─── Middleware ───────────────────────────────────────────────────────────────

/**
 * sanitizeXss
 * Recursively strips XSS from all string fields in body/query/params.
 * Encrypted fields are skipped — they're binary-safe already.
 *
 * NOTE on assignment strategy:
 *   req.body   → direct reassignment OK (writable property set by express.json)
 *   req.query  → Object.assign required (getter-only on IncomingMessage)
 *   req.params → Object.assign required (getter-only on IncomingMessage)
 */
export const sanitizeXss = asyncHandler(async (req, _res, next) => {
  if (req.body) req.body = xssClean(req.body); // body is writable — direct assign OK
  if (req.query) Object.assign(req.query, xssClean(req.query)); // getter-only — mutate in-place
  if (req.params) Object.assign(req.params, xssClean(req.params)); // getter-only — mutate in-place
  next();
});

// FIX [#10]: Removed unused `i` index parameter from the array map callback.
// The parent `key` is correctly passed down so ENCRYPTED_FIELDS checks work —
// the index was never used and only caused a lint warning.
function xssClean(data, key = null) {
  if (typeof data === 'string') {
    // Skip encrypted fields — never XSS clean raw encrypted values
    if (ENCRYPTED_FIELDS.has(key)) return data;
    return xss(data, xssOptions);
  }

  if (Array.isArray(data)) {
    return data.map(item => xssClean(item, key));
  }

  if (data !== null && typeof data === 'object') {
    const clean = {};
    for (const [k, v] of Object.entries(data)) {
      clean[k] = xssClean(v, k);
    }
    return clean;
  }

  return data;
}
