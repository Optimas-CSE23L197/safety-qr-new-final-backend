// =============================================================================
// timeout.js — RESQID
// Wrap any async operation with a hard timeout
// External service calls MUST have timeouts — never let them hang indefinitely
//
// Default timeouts per service:
//   SMS (MSG91):  5s  — OTP must arrive quickly
//   Push (FCM):   3s  — fire-and-forget, fast fail
//   Storage (S3): 10s — file uploads can be slow
//   GeoIP:        2s  — scan should never wait for geo
//   Payment:      15s — Razorpay needs more time
// =============================================================================

import { logger } from "../../config/logger.js";

// ─── Predefined Timeouts (ms) ────────────────────────────────────────────────
export const Timeouts = {
  SMS: 5_000,
  PUSH: 3_000,
  EMAIL: 8_000,
  STORAGE: 10_000,
  GEO: 2_000,
  PAYMENT: 15_000,
  DEFAULT: 5_000,
};

// ─── Core ─────────────────────────────────────────────────────────────────────

/**
 * withTimeout(promise, timeoutMs, label?)
 * Rejects if promise doesn't resolve within timeoutMs
 *
 * @param {Promise}  promise    - The operation to wrap
 * @param {number}   timeoutMs  - Maximum wait time in ms
 * @param {string}   [label]    - Name for logging/error message
 * @returns {Promise<*>}
 *
 * @example
 * const result = await withTimeout(
 *   msg91.sendOtp(phone, otp),
 *   Timeouts.SMS,
 *   'MSG91 OTP'
 * )
 */
export function withTimeout(promise, timeoutMs, label = "Operation") {
  let timeoutHandle;

  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => {
      const err = new TimeoutError(label, timeoutMs);
      logger.warn(
        { label, timeoutMs },
        `${label} timed out after ${timeoutMs}ms`,
      );
      reject(err);
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timeoutHandle);
  });
}

/**
 * withTimeoutFn(fn, timeoutMs, label?)
 * Wraps an async function (rather than a promise)
 * Useful for retry wrappers that call fn() each attempt
 *
 * @example
 * const safeFetch = withTimeoutFn(() => fetch(url), Timeouts.GEO, 'GeoIP')
 * const data = await safeFetch()
 */
export function withTimeoutFn(fn, timeoutMs, label = "Operation") {
  return (...args) => withTimeout(fn(...args), timeoutMs, label);
}

// ─── TimeoutError ─────────────────────────────────────────────────────────────

export class TimeoutError extends Error {
  constructor(label, timeoutMs) {
    super(`${label} timed out after ${timeoutMs}ms`);
    this.name = "TimeoutError";
    this.label = label;
    this.timeoutMs = timeoutMs;
    this.isTimeout = true;
  }
}
