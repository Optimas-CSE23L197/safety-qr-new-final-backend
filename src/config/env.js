// =============================================================================
// env.js — RESQID (CLEANED)
// Single source of truth for all environment variables
// =============================================================================

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

if (process.env.NODE_ENV !== 'production') {
  const envPath = path.resolve(__dirname, '../../.env');
  const result = dotenv.config({ path: envPath });
  if (result.error) {
    dotenv.config();
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const IS_PROD = process.env.NODE_ENV === 'production';
const errors = [];

function required(key, options = {}) {
  const value = process.env[key];
  if (!value || value.trim() === '') {
    if (IS_PROD || !options.prodOnly) {
      errors.push(`  ✗ ${key} — required but not set`);
    }
    return options.default ?? '';
  }
  const trimmed = value.trim();
  if (options.minLength && trimmed.length < options.minLength) {
    errors.push(`  ✗ ${key} — too short (min ${options.minLength} chars)`);
  }
  if (options.oneOf && !options.oneOf.includes(trimmed)) {
    errors.push(`  ✗ ${key} — invalid value '${trimmed}'`);
  }
  return trimmed;
}

function optional(key, defaultValue = '') {
  const value = process.env[key];
  if (!value || value.trim() === '') return defaultValue;
  return value.trim();
}

function optionalInt(key, defaultValue) {
  const raw = process.env[key];
  if (!raw) return defaultValue;
  const parsed = parseInt(raw.trim(), 10);
  if (isNaN(parsed)) {
    errors.push(`  ✗ ${key} — must be an integer`);
    return defaultValue;
  }
  return parsed;
}

function optionalBool(key, defaultValue = false) {
  const raw = process.env[key];
  if (!raw) return defaultValue;
  return raw.trim().toLowerCase() === 'true';
}

// ─── Parse All Variables ──────────────────────────────────────────────────────

const _env = {
  // Server
  NODE_ENV: optional('NODE_ENV', 'development'),
  PORT: optionalInt('PORT', 3000),
  API_URL: optional('API_URL', 'http://localhost:3000'),
  TRUST_PROXY: optionalInt('TRUST_PROXY', 1),

  // Database
  DATABASE_URL: required('DATABASE_URL', { minLength: 20 }),

  // Redis
  REDIS_URL: required('REDIS_URL', { minLength: 10 }),
  REDIS_PASSWORD: optional('REDIS_PASSWORD'),
  REDIS_TLS: optionalBool('REDIS_TLS', false),
  REDIS_KEY_PREFIX: optional('REDIS_KEY_PREFIX', 'resqid:'),
  REDIS_MAX_RETRIES_PER_REQUEST: optionalInt('REDIS_MAX_RETRIES_PER_REQUEST', 1),
  REDIS_CONNECT_TIMEOUT: optionalInt('REDIS_CONNECT_TIMEOUT', 10000),
  REDIS_COMMAND_TIMEOUT: optionalInt('REDIS_COMMAND_TIMEOUT', 5000),
  REDIS_KEEP_ALIVE: optionalInt('REDIS_KEEP_ALIVE', 30000),

  // JWT
  JWT_ACCESS_SECRET: required('JWT_ACCESS_SECRET', { minLength: 32 }),
  JWT_ACCESS_EXPIRY: optional('JWT_ACCESS_EXPIRY', '15m'),
  JWT_REFRESH_SECRET: required('JWT_REFRESH_SECRET', { minLength: 32 }),
  JWT_REFRESH_EXPIRY: optional('JWT_REFRESH_EXPIRY', '30d'),

  // CSRF
  CSRF_SECRET: required('CSRF_SECRET', { minLength: 32 }),

  // Maintenance
  MAINTENANCE_BYPASS_SECRET: required('MAINTENANCE_BYPASS_SECRET', { minLength: 16 }),

  // URLs
  SUPER_ADMIN_URL: required('SUPER_ADMIN_URL'),
  SCHOOL_ADMIN_URL: required('SCHOOL_ADMIN_URL'),
  SCAN_BASE_URL: optional('SCAN_BASE_URL', 'http://localhost:3000/s'),
  COOKIE_DOMAIN: optional('COOKIE_DOMAIN'),

  // Storage (Cloudflare R2)
  AWS_ACCESS_KEY_ID: required('AWS_ACCESS_KEY_ID', { prodOnly: true }),
  AWS_SECRET_ACCESS_KEY: required('AWS_SECRET_ACCESS_KEY', { prodOnly: true, minLength: 20 }),
  AWS_REGION: optional('AWS_REGION', 'auto'),
  AWS_S3_BUCKET: required('AWS_S3_BUCKET', { prodOnly: true }),
  AWS_S3_ENDPOINT: required('AWS_S3_ENDPOINT', { prodOnly: true }),
  AWS_CDN_DOMAIN: optional('AWS_CDN_DOMAIN'),

  // SMS (MSG91)
  MSG91_AUTH_KEY: required('MSG91_AUTH_KEY', { prodOnly: true }),
  MSG91_OTP_TEMPLATE_ID: required('MSG91_OTP_TEMPLATE_ID', { prodOnly: true }),
  MSG91_SENDER_ID: optional('MSG91_SENDER_ID', 'RESQID'),

  // Email (Resend)
  RESEND_API_KEY: required('RESEND_API_KEY', { prodOnly: true }),
  RESEND_FROM_EMAIL: optional('RESEND_FROM_EMAIL', 'noreply@mail.getresqid.in'),

  // Expo Push Notifications
  EXPO_ACCESS_TOKEN: optional('EXPO_ACCESS_TOKEN'),

  // Encryption
  ENCRYPTION_KEY: required('ENCRYPTION_KEY', { minLength: 64 }),
  LOOKUP_HASH_SECRET: required('LOOKUP_HASH_SECRET', { minLength: 32 }),
  TOKEN_HASH_SECRET: required('TOKEN_HASH_SECRET', { minLength: 32 }),
  SCAN_CODE_SECRET: required('SCAN_CODE_SECRET', { minLength: 64 }),

  // Logging
  LOG_LEVEL: optional('LOG_LEVEL', IS_PROD ? 'info' : 'debug'),
  LOG_FORMAT: optional('LOG_FORMAT', IS_PROD ? 'json' : 'pretty'),
  LOG_FILE_PATH: optional('LOG_FILE_PATH'),

  // Sentry
  SENTRY_DSN: optional('SENTRY_DSN'),
  SENTRY_ENVIRONMENT: optional('SENTRY_ENVIRONMENT', 'development'),
  SENTRY_TRACES_SAMPLE_RATE: parseFloat(optional('SENTRY_TRACES_SAMPLE_RATE', '0.1')),

  // Rate Limiting
  RATE_LIMIT_WINDOW_MS: optionalInt('RATE_LIMIT_WINDOW_MS', 60000),
  RATE_LIMIT_MAX_REQUESTS: optionalInt('RATE_LIMIT_MAX_REQUESTS', 100),
  ENABLE_RATE_LIMIT: optionalBool('ENABLE_RATE_LIMIT', !IS_PROD),

  // Worker Configuration
  WORKER_ROLE: optional('WORKER_ROLE', 'all'),
  ENABLE_PIPELINE_QUEUE: optionalBool('ENABLE_PIPELINE_QUEUE', false),
  SLACK_ALERTS_WEBHOOK: optional('SLACK_ALERTS_WEBHOOK'),
  ENABLE_STEP_METRICS: optionalBool('ENABLE_STEP_METRICS', false),

  // Token/QR
  TOKEN_VALIDITY_MONTHS: optionalInt('TOKEN_VALIDITY_MONTHS', 12),

  // Proxy
  BEHIND_CLOUDFLARE: optionalBool('BEHIND_CLOUDFLARE', false),
};

// ─── Validation ───────────────────────────────────────────────────────────────

if (_env.JWT_ACCESS_SECRET === _env.JWT_REFRESH_SECRET) {
  errors.push('  ✗ JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different');
}

if (!/^[0-9a-fA-F]{64}$/.test(_env.ENCRYPTION_KEY)) {
  errors.push('  ✗ ENCRYPTION_KEY must be 64 hex characters');
}

if (errors.length > 0) {
  console.error('\n╔══════════════════════════════════════════════════╗');
  console.error('║        RESQID — ENVIRONMENT VARIABLE ERROR       ║');
  console.error('╚══════════════════════════════════════════════════╝\n');
  errors.forEach(e => console.error(e));
  console.error('\nCopy .env.example to .env and fill in required values.\n');
  process.exit(1);
}

_env.IS_PROD = _env.NODE_ENV === 'production';
_env.IS_DEV = _env.NODE_ENV === 'development';

export const ENV = Object.freeze(_env);
