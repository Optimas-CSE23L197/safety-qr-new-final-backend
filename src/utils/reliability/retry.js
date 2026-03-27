// =============================================================================
// retry.js — RESQID
// Exponential backoff retry for unreliable external calls
// Used for: MSG91 OTP, Firebase push, AWS S3, Razorpay, ip-api.com
//
// Never retry: DB operations (Prisma handles connection pooling itself)
// Never retry: Auth operations (retrying failed auth is a security risk)
// =============================================================================

import { logger } from '#config/logger.js';

// ─── Config Defaults ──────────────────────────────────────────────────────────
const DEFAULT_OPTIONS = {
  maxAttempts: 3,
  baseDelayMs: 500, // 500ms → 1s → 2s (with jitter)
  maxDelayMs: 10_000, // cap at 10 seconds
  factor: 2, // exponential multiplier
  jitter: true, // add randomness to prevent thundering herd
  retryOn: null, // null = retry on any Error; fn(err) => bool for custom
};

// ─── Non-retryable error codes ────────────────────────────────────────────────
// These are permanent failures — retrying won't help
const NON_RETRYABLE_HTTP = new Set([400, 401, 403, 404, 409, 422, 429]);

/**
 * withRetry(fn, options?)
 * Wrap any async function with retry logic
 *
 * @param {Function} fn        - async function to retry
 * @param {object}   options
 * @returns {Promise<*>}
 *
 * @example
 * const data = await withRetry(
 *   () => msg91Client.sendOtp(phone, otp),
 *   { maxAttempts: 3, baseDelayMs: 1000 }
 * )
 */
export async function withRetry(fn, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastErr = null;
  let attempt = 0;

  while (attempt < opts.maxAttempts) {
    attempt++;

    try {
      return await fn();
    } catch (err) {
      lastErr = err;

      // Check if this error is retryable
      if (!isRetryable(err, opts.retryOn)) {
        logger.debug({ attempt, err: err.message }, 'Non-retryable error — stopping retry');
        throw err;
      }

      // Last attempt — throw immediately, no delay
      if (attempt >= opts.maxAttempts) break;

      const delay = computeDelay(attempt, opts);
      logger.warn(
        {
          attempt,
          maxAttempts: opts.maxAttempts,
          delayMs: delay,
          err: err.message,
        },
        `Retry attempt ${attempt}/${opts.maxAttempts} — retrying in ${delay}ms`
      );

      await sleep(delay);
    }
  }

  logger.error({ attempts: attempt, err: lastErr?.message }, 'All retry attempts exhausted');
  throw lastErr;
}

// ─── HTTP-Specific Retry ──────────────────────────────────────────────────────

/**
 * withHttpRetry(fetchFn, options?)
 * Like withRetry but understands HTTP status codes
 * Won't retry on client errors (4xx) — only server errors (5xx) and network failures
 */
export async function withHttpRetry(fetchFn, options = {}) {
  return withRetry(fetchFn, {
    ...options,
    retryOn: err => {
      // Network errors (no response) → always retry
      if (!err.status) return true;
      // 5xx → retry (server-side transient error)
      if (err.status >= 500) return true;
      // 429 Too Many Requests → retry (with longer delay)
      if (err.status === 429) return true;
      // 4xx → don't retry (our fault)
      return false;
    },
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isRetryable(err, retryOnFn) {
  if (typeof retryOnFn === 'function') return retryOnFn(err);
  // Default: retry on any error except non-retryable HTTP codes
  if (err.statusCode && NON_RETRYABLE_HTTP.has(err.statusCode)) return false;
  if (err.status && NON_RETRYABLE_HTTP.has(err.status)) return false;
  return true;
}

function computeDelay(attempt, opts) {
  const exponential = opts.baseDelayMs * Math.pow(opts.factor, attempt - 1);
  const capped = Math.min(exponential, opts.maxDelayMs);

  if (!opts.jitter) return capped;

  // Full jitter: random between 0 and computed delay
  return Math.floor(Math.random() * capped);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
