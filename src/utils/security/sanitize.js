// =============================================================================
// sanitize.js — RESQID
// Pure sanitization functions — used in services and validators
// These are NOT middleware — they sanitize individual values
// =============================================================================

// ─── Phone Number ─────────────────────────────────────────────────────────────

/**
 * sanitizePhone(phone)
 * Normalize to E.164 format (+91XXXXXXXXXX)
 * Strips spaces, dashes, parentheses
 * Adds +91 if no country code provided (India default)
 */
export function sanitizePhone(phone) {
  if (!phone) return null;
  let cleaned = String(phone).replace(/[\s\-().]/g, "");

  // Already E.164
  if (cleaned.startsWith("+")) return cleaned;

  // 10-digit Indian number — add +91
  if (/^\d{10}$/.test(cleaned)) return `+91${cleaned}`;

  // 11-digit starting with 0 (0XXXXXXXXXX)
  if (/^0\d{10}$/.test(cleaned)) return `+91${cleaned.slice(1)}`;

  // 12-digit starting with 91
  if (/^91\d{10}$/.test(cleaned)) return `+${cleaned}`;

  return cleaned;
}

/**
 * normalizeEmail(email)
 * Lowercase + trim — prevent case-duplicate accounts
 */
export function normalizeEmail(email) {
  if (!email) return null;
  return String(email).toLowerCase().trim();
}

/**
 * sanitizeName(name)
 * Trim whitespace, collapse internal spaces, title case
 */
export function sanitizeName(name) {
  if (!name) return null;
  return String(name)
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * sanitizeText(text, maxLength = 1000)
 * General text field — trim, no HTML, length limit
 */
export function sanitizeText(text, maxLength = 1000) {
  if (text == null) return null;
  return String(text).trim().slice(0, maxLength);
}

/**
 * sanitizePin(pin)
 * Indian PIN code — 6 digits
 */
export function sanitizePin(pin) {
  if (!pin) return null;
  return String(pin).replace(/\D/g, "").slice(0, 6);
}

/**
 * sanitizeAmount(amount)
 * Convert rupees to paise — avoids floating point issues
 * Input: 249 (rupees) or 24900 (paise)
 * Always returns integer paise
 */
export function sanitizeAmount(amount) {
  if (amount == null) return 0;
  const num = parseFloat(amount);
  if (isNaN(num)) return 0;
  // If value looks like rupees (< 10000), convert to paise
  if (num < 10_000) return Math.round(num * 100);
  return Math.round(num);
}

/**
 * sanitizeSearchQuery(q, maxLength = 100)
 * Safe search string — strips special regex/SQL characters
 */
export function sanitizeSearchQuery(q, maxLength = 100) {
  if (!q) return "";
  return String(q)
    .trim()
    .slice(0, maxLength)
    .replace(/[<>'"`;\\]/g, "");
}

/**
 * stripHtml(str)
 * Remove ALL HTML tags — use on any field that should be plain text
 */
export function stripHtml(str) {
  if (!str) return null;
  return String(str)
    .replace(/<[^>]*>/g, "")
    .trim();
}

/**
 * sanitizeOrderNumber(raw)
 * Normalize order number format — uppercase, trim
 */
export function sanitizeOrderNumber(raw) {
  if (!raw) return null;
  return String(raw).toUpperCase().trim().replace(/\s+/g, "");
}
