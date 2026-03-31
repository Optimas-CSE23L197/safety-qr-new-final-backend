// =============================================================================
// sanitize.middleware.js — RESQID
// NoSQL injection prevention + deep object sanitization
// Express 5 compatible — no express-mongo-sanitize (breaks on read-only req.query)
//
// Assignment strategy (preserved from original):
//   req.body   → direct reassignment (writable)
//   req.query  → Object.assign (getter-only in Express 5)
//   req.params → Object.assign (getter-only in Express 5)
// =============================================================================

import { asyncHandler } from '#shared/response/asyncHandler.js';
import { ApiError } from '#shared/response/ApiError.js';
import { logger } from '#config/logger.js';

// ─── NoSQL key detector ───────────────────────────────────────────────────────

const NOSQL_KEY_RE = /^\$|\.{1}/; // starts with $ or contains .

function stripNoSqlKeys(obj, depth = 0) {
  if (depth > 10) return obj;
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(v => stripNoSqlKeys(v, depth + 1));

  const clean = {};
  for (const [key, value] of Object.entries(obj)) {
    if (NOSQL_KEY_RE.test(key)) {
      // Don't silently drop — throw so the request is rejected
      throw new Error(`NoSQL injection key detected: "${key}"`);
    }
    clean[key] = stripNoSqlKeys(value, depth + 1);
  }
  return clean;
}

// ─── NoSQL Injection Sanitizer ────────────────────────────────────────────────

export const sanitizeNoSql = (req, res, next) => {
  try {
    if (req.body && typeof req.body === 'object') {
      req.body = stripNoSqlKeys(req.body);
    }
    // Object.assign — req.query is read-only getter in Express 5
    if (req.query && typeof req.query === 'object') {
      const cleanQuery = stripNoSqlKeys(req.query);
      Object.assign(req.query, cleanQuery);
    }
    if (req.params && typeof req.params === 'object') {
      const cleanParams = stripNoSqlKeys(req.params);
      Object.assign(req.params, cleanParams);
    }
    next();
  } catch (err) {
    logger.warn({ err: err.message, ip: req.ip, userId: req.userId }, 'NoSQL injection blocked');
    next(ApiError.badRequest('Invalid characters detected in request'));
  }
};

// ─── Deep Object Sanitizer ────────────────────────────────────────────────────

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_DEPTH = 10;
const MAX_STRING_LEN = 50_000;

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
  if (depth > MAX_DEPTH) throw new Error('Request payload nesting too deep');

  if (typeof obj === 'string') {
    if (obj.length > MAX_STRING_LEN)
      throw new Error(`String field exceeds maximum length of ${MAX_STRING_LEN}`);
    return obj;
  }

  if (Array.isArray(obj)) return obj.map(item => deepClean(item, depth + 1));

  if (obj !== null && typeof obj === 'object') {
    const clean = {};
    for (const [key, value] of Object.entries(obj)) {
      if (DANGEROUS_KEYS.has(key)) throw new Error('Prototype pollution attempt detected');
      clean[key] = deepClean(value, depth + 1);
    }
    return clean;
  }

  return obj;
}
