// =============================================================================
// env.js — RESQID
// Single source of truth for all environment variables
// Validates, coerces, and exports every ENV var used across the application
//
// Rules:
//   - REQUIRED vars: server crashes at startup with a clear message if missing
//   - OPTIONAL vars: have safe defaults, never crash
//   - PROD ONLY vars: enforced only when NODE_ENV === "production"
//   - All values are parsed and typed here — no raw process.env anywhere else
//   - Secrets are validated for minimum length/entropy
//   - Never log ENV values — only log which keys are missing
// =============================================================================

import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// Load .env file in non-production environments
// In production, env vars are injected by the deployment platform (Railway/Render/EC2)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

if (process.env.NODE_ENV !== "production") {
  // Walk up from src/config/ → project root
  const envPath = path.resolve(__dirname, "../../.env");
  const result = dotenv.config({ path: envPath });
  if (result.error) {
    // Try cwd as fallback (works when running from project root)
    dotenv.config();
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const IS_PROD = process.env.NODE_ENV === "production";
const errors = [];

function required(key, options = {}) {
  const value = process.env[key];

  if (!value || value.trim() === "") {
    if (IS_PROD || !options.prodOnly) {
      errors.push(`  ✗ ${key} — required but not set`);
    }
    return options.default ?? "";
  }

  const trimmed = value.trim();

  if (options.minLength && trimmed.length < options.minLength) {
    errors.push(
      `  ✗ ${key} — too short (min ${options.minLength} chars, got ${trimmed.length})`,
    );
  }

  if (options.oneOf && !options.oneOf.includes(trimmed)) {
    errors.push(
      `  ✗ ${key} — invalid value '${trimmed}', must be one of: [${options.oneOf.join(", ")}]`,
    );
  }

  return trimmed;
}

function optional(key, defaultValue = "") {
  const value = process.env[key];
  if (!value || value.trim() === "") return defaultValue;
  return value.trim();
}

function optionalInt(key, defaultValue) {
  const raw = process.env[key];
  if (!raw) return defaultValue;
  const parsed = parseInt(raw.trim(), 10);
  if (isNaN(parsed)) {
    errors.push(`  ✗ ${key} — must be an integer, got '${raw}'`);
    return defaultValue;
  }
  return parsed;
}

function optionalBool(key, defaultValue = false) {
  const raw = process.env[key];
  if (!raw) return defaultValue;
  return raw.trim().toLowerCase() === "true";
}

// ─── Parse All Variables ──────────────────────────────────────────────────────

const _env = {
  // ── Server ─────────────────────────────────────────────────────────────────
  NODE_ENV: optional("NODE_ENV", "development"),
  PORT: optionalInt("PORT", 3000),
  API_URL: optional("API_URL", "http://localhost:3000"),
  TRUST_PROXY: optionalInt("TRUST_PROXY", 1),

  // ── Database ───────────────────────────────────────────────────────────────
  DATABASE_URL: required("DATABASE_URL", { minLength: 20 }),
  SHADOW_DATABASE_URL: optional("SHADOW_DATABASE_URL"),

  // ── Redis ──────────────────────────────────────────────────────────────────
  REDIS_URL: required("REDIS_URL", { minLength: 10 }),
  REDIS_PASSWORD: optional("REDIS_PASSWORD"),
  REDIS_TLS: optionalBool("REDIS_TLS", false),

  // ── JWT ────────────────────────────────────────────────────────────────────
  // FIX: .env uses JWT_ACCESS_SECRET (not JWT_SECRET)
  JWT_ACCESS_SECRET: required("JWT_ACCESS_SECRET", { minLength: 32 }),
  JWT_ACCESS_EXPIRY: optional("JWT_ACCESS_EXPIRY", "15m"),
  JWT_REFRESH_SECRET: required("JWT_REFRESH_SECRET", { minLength: 32 }),
  JWT_REFRESH_EXPIRY: optional("JWT_REFRESH_EXPIRY", "30d"),

  // ── CSRF ───────────────────────────────────────────────────────────────────
  CSRF_SECRET: required("CSRF_SECRET", { minLength: 32 }),

  // ── Maintenance ────────────────────────────────────────────────────────────
  MAINTENANCE_BYPASS_SECRET: required("MAINTENANCE_BYPASS_SECRET", {
    minLength: 16,
  }),

  // ── Application URLs ───────────────────────────────────────────────────────
  SUPER_ADMIN_URL: required("SUPER_ADMIN_URL"),
  SCHOOL_ADMIN_URL: required("SCHOOL_ADMIN_URL"),
  MOBILE_APP_SCHEME: optional("MOBILE_APP_SCHEME", "capacitor://localhost"),
  CDN_URL: optional("CDN_URL", "http://localhost:3000/static"),

  // ── AWS S3 ─────────────────────────────────────────────────────────────────
  AWS_ACCESS_KEY_ID: required("AWS_ACCESS_KEY_ID", { prodOnly: true }),
  AWS_SECRET_ACCESS_KEY: required("AWS_SECRET_ACCESS_KEY", {
    prodOnly: true,
    minLength: 20,
  }),
  AWS_REGION: optional("AWS_REGION", "ap-south-1"),
  AWS_S3_BUCKET: required("AWS_S3_BUCKET", { prodOnly: true }),
  AWS_S3_ENDPOINT: optional("AWS_S3_ENDPOINT"),

  // ── MSG91 ──────────────────────────────────────────────────────────────────
  MSG91_AUTH_KEY: required("MSG91_AUTH_KEY", { prodOnly: true }),
  MSG91_OTP_TEMPLATE_ID: required("MSG91_OTP_TEMPLATE_ID", { prodOnly: true }),
  MSG91_SENDER_ID: optional("MSG91_SENDER_ID", "RESQID"),
  MSG91_ROUTE: optional("MSG91_ROUTE", "4"),

  // ── Razorpay ───────────────────────────────────────────────────────────────
  RAZORPAY_KEY_ID: required("RAZORPAY_KEY_ID", { prodOnly: true }),
  RAZORPAY_KEY_SECRET: required("RAZORPAY_KEY_SECRET", { prodOnly: true }),
  RAZORPAY_WEBHOOK_SECRET: required("RAZORPAY_WEBHOOK_SECRET", {
    prodOnly: true,
    minLength: 16,
  }),

  // ── Email / SMTP ───────────────────────────────────────────────────────────
  SMTP_HOST: required("SMTP_HOST", { prodOnly: true }),
  SMTP_PORT: optionalInt("SMTP_PORT", 587),
  SMTP_USER: required("SMTP_USER", { prodOnly: true }),
  SMTP_PASS: required("SMTP_PASS", { prodOnly: true }),
  EMAIL_FROM: optional("EMAIL_FROM", "noreply@resqid.in"),
  EMAIL_FROM_NAME: optional("EMAIL_FROM_NAME", "RESQID"),

  // ── Firebase FCM ───────────────────────────────────────────────────────────
  FIREBASE_PROJECT_ID: required("FIREBASE_PROJECT_ID", { prodOnly: true }),
  FIREBASE_CLIENT_EMAIL: required("FIREBASE_CLIENT_EMAIL", { prodOnly: true }),
  FIREBASE_PRIVATE_KEY: optional("FIREBASE_PRIVATE_KEY", "").replace(
    /\\n/g,
    "\n",
  ),

  // ── Encryption — AES-256-GCM ───────────────────────────────────────────────
  // IV is generated per-field via crypto.randomBytes(12) in encryption.js
  // A static IV in env would break GCM security — intentionally not here
  ENCRYPTION_KEY: required("ENCRYPTION_KEY", { minLength: 64 }),

  // ── Phone Index Hashing ────────────────────────────────────────────────────
  // Used by hashForLookup() in encryption.js for phone_index HMAC
  LOOKUP_HASH_SECRET: required("LOOKUP_HASH_SECRET", { minLength: 32 }),

  // ── IP Geolocation ─────────────────────────────────────────────────────────
  IP_GEO_API_KEY: optional("IP_GEO_API_KEY"),
  IP_GEO_PROVIDER: optional("IP_GEO_PROVIDER", "ipapi"),

  // ── Logging ────────────────────────────────────────────────────────────────
  LOG_LEVEL: optional("LOG_LEVEL", IS_PROD ? "info" : "debug"),
  LOG_FORMAT: optional("LOG_FORMAT", IS_PROD ? "json" : "pretty"),
  LOG_FILE_PATH: optional("LOG_FILE_PATH"),

  // ── Sentry ─────────────────────────────────────────────────────────────────
  SENTRY_DSN: optional("SENTRY_DSN"),
  SENTRY_ENVIRONMENT: optional("SENTRY_ENVIRONMENT", "development"),
  SENTRY_TRACES_SAMPLE_RATE: parseFloat(
    optional("SENTRY_TRACES_SAMPLE_RATE", "0.1"),
  ),

  // ── Geo Blocking ───────────────────────────────────────────────────────────
  BEHIND_CLOUDFLARE: optionalBool("BEHIND_CLOUDFLARE", false),
  BEHIND_CLOUDFRONT: optionalBool("BEHIND_CLOUDFRONT", false),

  // ── Token / QR ─────────────────────────────────────────────────────────────
  TOKEN_VALIDITY_MONTHS: optionalInt("TOKEN_VALIDITY_MONTHS", 12),
  QR_DEFAULT_SIZE_PX: optionalInt("QR_DEFAULT_SIZE_PX", 512),
};

// ─── Cross-Field Validation ───────────────────────────────────────────────────

if (
  _env.JWT_ACCESS_SECRET &&
  _env.JWT_REFRESH_SECRET &&
  _env.JWT_ACCESS_SECRET === _env.JWT_REFRESH_SECRET
) {
  errors.push(
    "  ✗ JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different values",
  );
}

if (_env.ENCRYPTION_KEY && !/^[0-9a-fA-F]{64}$/.test(_env.ENCRYPTION_KEY)) {
  errors.push(
    "  ✗ ENCRYPTION_KEY must be exactly 64 hexadecimal characters (32 bytes)",
  );
}

// ─── Startup Guard ────────────────────────────────────────────────────────────

if (errors.length > 0) {
  console.error("\n╔══════════════════════════════════════════════════╗");
  console.error("║        RESQID — ENVIRONMENT VARIABLE ERROR       ║");
  console.error("╚══════════════════════════════════════════════════╝");
  console.error(
    "\nThe following environment variables are invalid or missing:\n",
  );
  errors.forEach((e) => console.error(e));
  console.error(
    "\nCopy .env.example to .env and fill in the required values.\n",
  );
  process.exit(1);
}

// ─── Derived Convenience Flags ────────────────────────────────────────────────

_env.IS_PROD = _env.NODE_ENV === "production";
_env.IS_DEV = _env.NODE_ENV === "development";
_env.IS_STAGING = _env.NODE_ENV === "staging";

// ─── Freeze + Export ──────────────────────────────────────────────────────────

export const ENV = Object.freeze(_env);
