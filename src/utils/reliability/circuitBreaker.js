// =============================================================================
// circuitBreaker.js — RESQID
// Circuit breaker pattern — stops calling a failing service repeatedly
// States: CLOSED → OPEN → HALF_OPEN → CLOSED (or OPEN again)
//
// Used for: MSG91, Firebase, AWS S3, Razorpay, ip-api.com
// If MSG91 is down → circuit opens → OTP sends queued → parents not affected
// =============================================================================

import { logger } from "../../config/logger.js";

// ─── States ───────────────────────────────────────────────────────────────────
const STATE = {
  CLOSED: "CLOSED", // Normal — requests pass through
  OPEN: "OPEN", // Failing — requests blocked immediately
  HALF_OPEN: "HALF_OPEN", // Testing — one request allowed to check recovery
};

// ─── Circuit Breaker Class ────────────────────────────────────────────────────

export class CircuitBreaker {
  /**
   * @param {string} name          - Service name for logging
   * @param {object} options
   * @param {number} options.failureThreshold  - Failures before OPEN (default: 5)
   * @param {number} options.successThreshold  - Successes to CLOSE from HALF_OPEN (default: 2)
   * @param {number} options.timeoutMs         - How long to stay OPEN (default: 60s)
   */
  constructor(name, options = {}) {
    this.name = name;
    this.failureThreshold = options.failureThreshold ?? 5;
    this.successThreshold = options.successThreshold ?? 2;
    this.timeoutMs = options.timeoutMs ?? 60_000; // 60s

    this._state = STATE.CLOSED;
    this._failureCount = 0;
    this._successCount = 0;
    this._lastFailureAt = null;
    this._openedAt = null;
  }

  // ─── Execute ─────────────────────────────────────────────────────────────

  /**
   * execute(fn)
   * Wrap a service call with circuit breaker protection
   * Throws CircuitOpenError if circuit is OPEN
   *
   * @param {Function} fn - async function to execute
   * @returns {Promise<*>}
   */
  async execute(fn) {
    if (this._state === STATE.OPEN) {
      if (this._shouldAttemptReset()) {
        this._transitionTo(STATE.HALF_OPEN);
      } else {
        throw new CircuitOpenError(this.name, this._openedAt, this.timeoutMs);
      }
    }

    try {
      const result = await fn();
      this._onSuccess();
      return result;
    } catch (err) {
      this._onFailure(err);
      throw err;
    }
  }

  // ─── State Machine ────────────────────────────────────────────────────────

  _onSuccess() {
    this._lastFailureAt = null;

    if (this._state === STATE.HALF_OPEN) {
      this._successCount++;
      if (this._successCount >= this.successThreshold) {
        this._reset();
        logger.info(
          { circuit: this.name },
          `Circuit CLOSED — service recovered`,
        );
      }
    } else {
      this._failureCount = 0;
    }
  }

  _onFailure(err) {
    this._lastFailureAt = Date.now();
    this._failureCount++;

    if (this._state === STATE.HALF_OPEN) {
      // Any failure in HALF_OPEN → back to OPEN
      this._trip();
      return;
    }

    if (this._failureCount >= this.failureThreshold) {
      this._trip();
    }

    logger.warn(
      {
        circuit: this.name,
        state: this._state,
        failureCount: this._failureCount,
        threshold: this.failureThreshold,
        err: err.message,
      },
      `Circuit failure recorded`,
    );
  }

  _trip() {
    this._openedAt = Date.now();
    this._transitionTo(STATE.OPEN);
    logger.error(
      {
        circuit: this.name,
        failureCount: this._failureCount,
        opensForMs: this.timeoutMs,
      },
      `Circuit OPENED — ${this.name} is failing`,
    );
  }

  _reset() {
    this._failureCount = 0;
    this._successCount = 0;
    this._openedAt = null;
    this._lastFailureAt = null;
    this._transitionTo(STATE.CLOSED);
  }

  _shouldAttemptReset() {
    return this._openedAt && Date.now() - this._openedAt >= this.timeoutMs;
  }

  _transitionTo(newState) {
    logger.debug(
      { circuit: this.name, from: this._state, to: newState },
      "Circuit state transition",
    );
    this._state = newState;
  }

  // ─── Getters ──────────────────────────────────────────────────────────────

  get state() {
    return this._state;
  }
  get isOpen() {
    return this._state === STATE.OPEN;
  }
  get isClosed() {
    return this._state === STATE.CLOSED;
  }
  get failureCount() {
    return this._failureCount;
  }

  getStatus() {
    return {
      name: this.name,
      state: this._state,
      failureCount: this._failureCount,
      openedAt: this._openedAt,
      lastFailure: this._lastFailureAt,
    };
  }
}

// ─── CircuitOpenError ─────────────────────────────────────────────────────────

export class CircuitOpenError extends Error {
  constructor(serviceName, openedAt, timeoutMs) {
    const retryIn = openedAt
      ? Math.max(0, timeoutMs - (Date.now() - openedAt))
      : timeoutMs;
    super(
      `Circuit breaker OPEN for '${serviceName}' — retry in ${Math.ceil(retryIn / 1000)}s`,
    );
    this.name = "CircuitOpenError";
    this.serviceName = serviceName;
    this.retryIn = retryIn;
    this.isOperational = true;
    this.statusCode = 503;
  }
}

// ─── Pre-built Breakers for RESQID Services ───────────────────────────────────

export const breakers = {
  msg91: new CircuitBreaker("MSG91", {
    failureThreshold: 3,
    timeoutMs: 30_000,
  }),
  firebase: new CircuitBreaker("Firebase", {
    failureThreshold: 5,
    timeoutMs: 60_000,
  }),
  s3: new CircuitBreaker("AWS-S3", { failureThreshold: 5, timeoutMs: 60_000 }),
  razorpay: new CircuitBreaker("Razorpay", {
    failureThreshold: 3,
    timeoutMs: 60_000,
  }),
  geoip: new CircuitBreaker("GeoIP", {
    failureThreshold: 5,
    timeoutMs: 30_000,
  }),
};
