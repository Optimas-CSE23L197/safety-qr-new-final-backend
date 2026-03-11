// =============================================================================
// slugify.js — RESQID
// URL-safe slug generation — used for:
//   - School codes: "St. Xavier's High School" → "st-xaviers-high-school"
//   - Order numbers: "ORD-2024-0042"
//   - File names: safe characters only
//
// Uses the 'slugify' npm package as engine, with opinionated defaults.
// =============================================================================

import slugifyLib from "slugify";

// ─── Base Config ──────────────────────────────────────────────────────────────
const BASE_OPTIONS = {
  replacement: "-", // replace spaces and invalid chars with hyphen
  lower: true, // always lowercase
  strict: true, // strip anything not alphanumeric or replacement char
  trim: true,
  locale: "en", // handle Indian characters gracefully
};

// ─── Core ─────────────────────────────────────────────────────────────────────

/**
 * slugify(text, options?)
 * General-purpose slug — "St. Xavier's School" → "st-xaviers-school"
 *
 * @param {string}  text
 * @param {object}  [options]
 * @returns {string}
 */
export function slugify(text, options = {}) {
  if (!text) return "";
  return slugifyLib(String(text), { ...BASE_OPTIONS, ...options });
}

/**
 * toSchoolCode(schoolName)
 * Generate a unique-prefix school code from name.
 * Used as School.code — short, uppercase, no hyphens.
 * "St. Xavier's High School, Mumbai" → "STXAVIERS"
 *
 * @param {string}  schoolName
 * @param {number}  [maxLength=10]
 * @returns {string}
 */
export function toSchoolCode(schoolName, maxLength = 10) {
  if (!schoolName) return "";

  const base = slugifyLib(schoolName, {
    replacement: "",
    lower: false,
    strict: true,
    trim: true,
  });

  return base.toUpperCase().slice(0, maxLength);
}

/**
 * toOrderNumber(prefix, sequence)
 * Build a padded order number.
 * toOrderNumber('ORD-2024', 42) → "ORD-2024-0042"
 *
 * @param {string} prefix     - e.g. 'ORD-2024'
 * @param {number} sequence   - auto-increment from DB
 * @param {number} [pad=4]    - zero-pad to this length
 * @returns {string}
 */
export function toOrderNumber(prefix, sequence, pad = 4) {
  const padded = String(sequence).padStart(pad, "0");
  return `${prefix}-${padded}`;
}

/**
 * toSafeFileName(name)
 * Make a string safe to use as a file name — no path chars, no spaces.
 * "Student Report 2024.pdf" → "student-report-2024.pdf"
 *
 * @param {string} name
 * @returns {string}
 */
export function toSafeFileName(name) {
  if (!name) return "";

  // Preserve extension
  const lastDot = name.lastIndexOf(".");
  const hasExt = lastDot > 0 && lastDot < name.length - 1;

  const base = hasExt ? name.slice(0, lastDot) : name;
  const ext = hasExt ? name.slice(lastDot) : "";

  return slugify(base) + ext.toLowerCase();
}

/**
 * toCardNumber(raw)
 * Normalize physical card number — uppercase, no spaces.
 * "RQD 2024 A001" → "RQD2024A001"
 */
export function toCardNumber(raw) {
  if (!raw) return "";
  return String(raw).toUpperCase().replace(/\s+/g, "").trim();
}
