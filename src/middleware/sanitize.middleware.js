// =============================================================================
// sanitize.middleware.js — RESQID
// NoSQL injection prevention + deep object sanitization
// Runs BEFORE validation — clean data before any schema check
//
// FIX [#5]: The original two-middleware pattern (sanitizeNoSql then
// rejectIfInjectionDetected) was fragile — if any middleware was inserted
// between them, the request would proceed with flagged data. Consolidated
// into a single sanitizeNoSql wrapper that throws immediately on detection,
// removing the inter-middleware dependency entirely.
//
// NOTE on assignment strategy:
//   req.body   → direct reassignment OK (writable property set by express.json)
//   req.query  → Object.assign required (getter-only on IncomingMessage)
//   req.params → Object.assign required (getter-only on IncomingMessage)
//   This pattern is intentional and must be preserved in any future edits
//   to this file or xss.middleware.js which follows the same convention.
// =============================================================================

import mongoSanitize from "express-mongo-sanitize";
import { asyncHandler } from "../utils/response/asyncHandler.js";
import { ApiError } from "../utils/response/ApiError.js";

// ─── NoSQL Injection Sanitizer ────────────────────────────────────────────────

/**
 * sanitizeNoSql
 * Wraps express-mongo-sanitize with immediate rejection on injection detection.
 *
 * Previously: mongoSanitize set req._injectionDetected = true and a separate
 * rejectIfInjectionDetected middleware had to follow immediately after.
 * That pattern was fragile — a misplaced middleware between them would let
 * flagged requests through.
 *
 * Now: Uses asyncHandler so we can throw synchronously after mongoSanitize
 * runs. The mongoSanitize call is executed inline and any detected injection
 * kills the request in the same middleware, no follow-up step required.
 */
export const sanitizeNoSql = (req, res, next) => {
  let injectionDetected = false;
  let injectedKey = null;

  const middleware = mongoSanitize({
    replaceWith: "_",
    allowDots: false,
    onSanitize: ({ key }) => {
      injectionDetected = true;
      injectedKey = key;
    },
  });

  middleware(req, res, (err) => {
    if (err) return next(err);

    if (injectionDetected) {
      req.log?.warn(
        { key: injectedKey, userId: req.userId, ip: req.ip },
        "NoSQL injection attempt blocked",
      );

      return next(
        ApiError.badRequest("Invalid characters detected in request"),
      );
    }

    next();
  });
};

// ─── Deep Object Sanitizer ────────────────────────────────────────────────────

const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const MAX_DEPTH = 10;
const MAX_STRING_LEN = 50_000; // 50KB max per string field

/**
 * sanitizeDeep
 * Recursively validates object structure.
 * Blocks: prototype pollution, excessively deep nesting, oversized strings.
 *
 * Assignment strategy:
 *   req.body   → direct reassignment (body is a plain writable property)
 *   req.query  → Object.assign (getter-only — cannot be directly reassigned)
 *   req.params → Object.assign (getter-only — cannot be directly reassigned)
 */
export const sanitizeDeep = asyncHandler(async (req, _res, next) => {
  try {
    if (req.body) {
      req.body = deepClean(req.body, 0);
    }

    if (req.query) {
      Object.assign(req.query, deepClean(req.query, 0));
    }

    if (req.params) {
      Object.assign(req.params, deepClean(req.params, 0));
    }
  } catch (err) {
    throw ApiError.badRequest(err.message);
  }
  next();
});

function deepClean(obj, depth) {
  if (depth > MAX_DEPTH) {
    throw new Error("Request payload nesting too deep");
  }

  if (typeof obj === "string") {
    if (obj.length > MAX_STRING_LEN) {
      throw new Error(
        `String field exceeds maximum length of ${MAX_STRING_LEN}`,
      );
    }
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => deepClean(item, depth + 1));
  }

  if (obj !== null && typeof obj === "object") {
    const clean = {};
    for (const [key, value] of Object.entries(obj)) {
      if (DANGEROUS_KEYS.has(key)) {
        throw new Error("Prototype pollution attempt detected");
      }
      clean[key] = deepClean(value, depth + 1);
    }
    return clean;
  }

  return obj;
}
