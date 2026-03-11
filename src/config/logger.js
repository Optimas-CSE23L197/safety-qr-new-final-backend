// =============================================================================
// logger.js — RESQID
// Production-grade structured logger using Pino
// - JSON in production, pretty-printed in development
// - Automatic redaction of sensitive fields in any log object
// - File transport support for persistent log storage
// - Child logger factory for per-request context
// - Sentry integration for error/fatal level events
// =============================================================================

import pino from "pino";
import { ENV } from "./env.js";

// ─── Sensitive Field Redaction ────────────────────────────────────────────────
// Pino redacts these fields before writing — even if accidentally logged
// Uses dot-notation and wildcard paths
// Add any new sensitive field names here as the codebase grows

const REDACT_PATHS = [
  // Auth secrets
  "password",
  "password_hash",
  "*.password",
  "*.password_hash",

  // Tokens
  "token",
  "token_hash",
  "refresh_token",
  "access_token",
  "*.token",
  "*.token_hash",
  "*.refresh_token",

  // OTP
  "otp",
  "otp_hash",
  "*.otp",
  "*.otp_hash",

  // PII — encrypted fields
  "dob_encrypted",
  "phone_encrypted",
  "doctor_phone_encrypted",
  "*.dob_encrypted",
  "*.phone_encrypted",
  "*.doctor_phone_encrypted",

  // Crypto secrets
  "secret",
  "private_key",
  "*.secret",
  "*.private_key",

  // HTTP headers — in case headers object is logged
  'req.headers["authorization"]',
  'req.headers["cookie"]',
  'req.headers["x-csrf-token"]',
  'req.headers["x-api-key"]',

  // Payment
  "cvv",
  "card_number",
  "*.cvv",
  "*.card_number",
];

// ─── Transport Config ─────────────────────────────────────────────────────────

function buildTransport() {
  const targets = [];

  // Always write JSON to stdout.
  // In dev: the npm script pipes through external pino-pretty (| pino-pretty).
  // In prod: JSON stdout is picked up by log aggregators (Datadog, CloudWatch).
  // Never use internal pino-pretty transport — when only 1 target, pino.transport
  // is not called and a plain object is returned, causing stream.write crash.
  targets.push({
    target: "pino/file",
    level: ENV.LOG_LEVEL,
    options: { destination: 1 }, // 1 = stdout
  });

  // File transport — write to disk if LOG_FILE_PATH is set
  if (ENV.LOG_FILE_PATH) {
    targets.push({
      target: "pino/file",
      level: ENV.LOG_LEVEL,
      options: {
        destination: ENV.LOG_FILE_PATH,
        mkdir: true, // create directory if it doesn't exist
      },
    });
  }

  // Always wrap in pino.transport() — never return a plain object.
  // pino() requires a writable stream as its second argument.
  return pino.transport({ targets });
}

// ─── Base Logger ──────────────────────────────────────────────────────────────

export const logger = pino(
  {
    level: ENV.LOG_LEVEL,

    // Application context — on every log line
    base: {
      app: "resqid",
      env: ENV.NODE_ENV,
      pid: process.pid,
    },

    // Timestamp — ISO 8601 in production, readable in dev
    timestamp: pino.stdTimeFunctions.isoTime,

    // Redact sensitive fields before writing
    redact: {
      paths: REDACT_PATHS,
      censor: "[REDACTED]",
    },

    // Serialize Error objects properly
    serializers: {
      err: pino.stdSerializers.err,
      error: pino.stdSerializers.err,
      req: pino.stdSerializers.req,
      res: pino.stdSerializers.res,
    },

    // Map Pino levels to standard severity names (useful for log aggregators)
    formatters: {
      level(label) {
        return { level: label.toUpperCase() };
      },
      bindings(bindings) {
        return {
          app: bindings.app,
          env: bindings.env,
          pid: bindings.pid,
        };
      },
    },

    // Prevent crashes from circular references in logged objects
    safe: true,
  },
  buildTransport(),
);

// ─── Sentry Integration ───────────────────────────────────────────────────────
// Forward error + fatal logs to Sentry for alerting
// Only active in production when SENTRY_DSN is set

if (ENV.IS_PROD && ENV.SENTRY_DSN) {
  try {
    const Sentry = await import("@sentry/node");

    Sentry.init({
      dsn: ENV.SENTRY_DSN,
      environment: ENV.SENTRY_ENVIRONMENT,
      tracesSampleRate: ENV.SENTRY_TRACES_SAMPLE_RATE,
      // Don't send PII to Sentry — scrub user data
      beforeSend(event) {
        // Strip user IP from Sentry events
        if (event.user) {
          delete event.user.ip_address;
          delete event.user.email;
        }
        return event;
      },
    });

    // Patch logger to forward error/fatal to Sentry
    const originalError = logger.error.bind(logger);
    const originalFatal = logger.fatal.bind(logger);

    logger.error = (obj, msg, ...args) => {
      originalError(obj, msg, ...args);
      if (obj?.err || obj instanceof Error) {
        Sentry.captureException(obj?.err ?? obj, {
          extra: typeof obj === "object" ? obj : { message: obj },
        });
      }
    };

    logger.fatal = (obj, msg, ...args) => {
      originalFatal(obj, msg, ...args);
      Sentry.captureException(obj?.err ?? obj, {
        level: "fatal",
        extra: typeof obj === "object" ? obj : { message: obj },
      });
    };

    logger.info("Sentry error monitoring initialized");
  } catch (e) {
    logger.warn(
      { err: e.message },
      "Sentry init failed — continuing without it",
    );
  }
}

// ─── Child Logger Factory ─────────────────────────────────────────────────────

/**
 * createRequestLogger
 * Creates a child logger bound to a specific request context
 * Used in httpLogger.middleware.js
 */
export function createRequestLogger(context) {
  return logger.child(context);
}
