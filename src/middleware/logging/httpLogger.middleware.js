// =============================================================================
// httpLogger.middleware.js — RESQID (ENHANCED with Terminal Logging)
// Structured HTTP request/response logging via Pino + Terminal Console
// - Every request gets a unique log entry with timing
// - Shows all API hits with icons and colors
// - OTP codes are displayed in a beautiful box in development
// - Sensitive fields are NEVER logged in production
// =============================================================================

import { logger } from '#config/logger.js';
import { extractIp } from '#shared/network/extractIp.js';

// ─── Fields to NEVER log — security critical ─────────────────────────────────
const REDACTED = '[REDACTED]';

const SENSITIVE_HEADERS = new Set([
  'authorization',
  'cookie',
  'x-csrf-token',
  'x-api-key',
  'proxy-authorization',
]);

const SENSITIVE_BODY_KEYS = new Set([
  'password',
  'password_hash',
  'otp',
  'otp_hash',
  'token',
  'token_hash',
  'refresh_token',
  'secret',
  'private_key',
  'credit_card',
  'cvv',
]);

// ─── Routes with elevated logging (full body capture) ───────────────────────
const ELEVATED_LOG_ROUTES = new Set([
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/refresh',
  '/api/auth/send-otp',
  '/api/auth/verify-otp',
  '/api/auth/register/init',
  '/api/auth/register/verify',
]);

// ─── Terminal Logging Helpers ────────────────────────────────────────────────

// Get method icon
const getMethodIcon = method => {
  switch (method) {
    case 'GET':
      return '📥';
    case 'POST':
      return '📤';
    case 'PUT':
      return '🔄';
    case 'PATCH':
      return '⚡';
    case 'DELETE':
      return '🗑️';
    default:
      return '📡';
  }
};

// Get status icon
const getStatusIcon = statusCode => {
  if (statusCode >= 500) return '❌';
  if (statusCode >= 400) return '⚠️';
  if (statusCode >= 300) return '↪️';
  return '✅';
};

// Format duration with appropriate unit
const formatDuration = ms => {
  if (ms < 1) return `${Math.round(ms * 1000)}μs`;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
};

// Get colored status text with icon
const getColoredStatus = statusCode => {
  const icon = getStatusIcon(statusCode);
  if (statusCode >= 500) return `\x1b[31m${icon} ${statusCode}\x1b[0m`;
  if (statusCode >= 400) return `\x1b[33m${icon} ${statusCode}\x1b[0m`;
  if (statusCode >= 300) return `\x1b[36m${icon} ${statusCode}\x1b[0m`;
  return `\x1b[32m${icon} ${statusCode}\x1b[0m`;
};

// Generate duration bar for visual response time
const getDurationBar = (ms, maxWidth = 20) => {
  const barLength = Math.min(Math.floor(ms / 5), maxWidth);
  if (barLength <= 0) return '';
  const color = ms < 100 ? '\x1b[32m' : ms < 500 ? '\x1b[33m' : '\x1b[31m';
  return `${color}█`.repeat(barLength) + '\x1b[0m';
};

// Display OTP in a beautiful box
const displayOtpBox = (phone, otp, purpose = 'LOGIN') => {
  const timestamp = new Date().toLocaleTimeString();
  const border = '╔══════════════════════════════════════════════════════════════════╗';
  const bottom = '╚══════════════════════════════════════════════════════════════════╝';

  console.log(`\n\x1b[36m${border}\x1b[0m`);
  console.log(
    `\x1b[36m║  \x1b[33m🔐 OTP VERIFICATION CODE\x1b[0m                                                       \x1b[36m║\x1b[0m`
  );
  console.log(
    `\x1b[36m╠══════════════════════════════════════════════════════════════════╣\x1b[0m`
  );
  console.log(`\x1b[36m║  \x1b[37mPurpose:\x1b[0m ${purpose.padEnd(66)}\x1b[36m║\x1b[0m`);
  console.log(`\x1b[36m║  \x1b[37mPhone:  \x1b[0m ${phone.padEnd(66)}\x1b[36m║\x1b[0m`);
  console.log(`\x1b[36m║  \x1b[37mOTP:    \x1b[32m${otp.padEnd(66)}\x1b[36m║\x1b[0m`);
  console.log(`\x1b[36m║  \x1b[37mTime:   \x1b[0m ${timestamp.padEnd(66)}\x1b[36m║\x1b[0m`);
  console.log(`\x1b[36m║  \x1b[37mExpires:\x1b[0m 5 minutes${' '.padEnd(57)}\x1b[36m║\x1b[0m`);
  console.log(`\x1b[36m${bottom}\x1b[0m\n`);
};

// Display error in a box
const displayErrorBox = (message, statusCode, path) => {
  const border = '╔══════════════════════════════════════════════════════════════════╗';
  const bottom = '╚══════════════════════════════════════════════════════════════════╝';

  console.log(`\n\x1b[31m${border}\x1b[0m`);
  console.log(
    `\x1b[31m║  \x1b[33m❌ API ERROR\x1b[0m                                                               \x1b[31m║\x1b[0m`
  );
  console.log(
    `\x1b[31m╠══════════════════════════════════════════════════════════════════╣\x1b[0m`
  );
  console.log(
    `\x1b[31m║  \x1b[37mStatus: \x1b[31m${statusCode}\x1b[0m${' '.padEnd(61)}\x1b[31m║\x1b[0m`
  );
  console.log(`\x1b[31m║  \x1b[37mPath:   \x1b[0m${path.padEnd(66)}\x1b[31m║\x1b[0m`);
  console.log(
    `\x1b[31m║  \x1b[37mMessage:\x1b[31m ${message.slice(0, 66).padEnd(66)}\x1b[31m║\x1b[0m`
  );
  console.log(`\x1b[31m${bottom}\x1b[0m\n`);
};

// Display success box for critical operations
const displaySuccessBox = (message, details = '') => {
  const border = '╔══════════════════════════════════════════════════════════════════╗';
  const bottom = '╚══════════════════════════════════════════════════════════════════╝';

  console.log(`\n\x1b[32m${border}\x1b[0m`);
  console.log(
    `\x1b[32m║  \x1b[36m✨ OPERATION SUCCESS\x1b[0m                                                       \x1b[32m║\x1b[0m`
  );
  console.log(
    `\x1b[32m╠══════════════════════════════════════════════════════════════════╣\x1b[0m`
  );
  console.log(`\x1b[32m║  \x1b[37m${message.slice(0, 66).padEnd(66)}\x1b[32m║\x1b[0m`);
  if (details) {
    console.log(`\x1b[32m║  \x1b[90m${details.slice(0, 66).padEnd(66)}\x1b[32m║\x1b[0m`);
  }
  console.log(`\x1b[32m${bottom}\x1b[0m\n`);
};

// ─── Core Logger Middleware ──────────────────────────────────────────────────

export function httpLogger(req, res, next) {
  const startAt = process.hrtime.bigint();
  const reqId = req.id ?? req.requestId;
  const ip = extractIp(req);
  const method = req.method;
  const path = req.path;

  // Log incoming request to terminal
  const methodIcon = getMethodIcon(method);
  const userStr = req.userId
    ? ` \x1b[90m[${req.role || 'user'}:${req.userId.slice(0, 8)}]\x1b[0m`
    : ' \x1b[90m[anonymous]\x1b[0m';

  console.log(
    `\n${methodIcon} \x1b[36m${method}\x1b[0m \x1b[2m${path}\x1b[0m${userStr} \x1b[90m→ ${ip}\x1b[0m`
  );

  // Create child logger for structured logs
  const baseChild = logger.child({
    requestId: reqId,
    ip,
  });

  // Attach to req
  req.log = baseChild;

  // Log incoming request to structured logger
  req.log.info(
    {
      type: 'request',
      method: req.method,
      url: sanitizeUrl(req.originalUrl),
      headers: sanitizeHeaders(req.headers),
      ...(shouldLogBody(req) && { body: sanitizeBody(req.body) }),
    },
    `→ ${req.method} ${req.path}`
  );

  // Capture request body for OTP detection
  let requestBody = null;
  let otpPurpose = 'LOGIN';
  if (req.body && (req.path === '/api/auth/send-otp' || req.path === '/api/auth/register/init')) {
    requestBody = { ...req.body };
    if (req.path === '/api/auth/register/init') otpPurpose = 'REGISTRATION';
  }

  // Intercept response finish to log outgoing
  res.on('finish', () => {
    const durationNs = process.hrtime.bigint() - startAt;
    const durationMs = Number(durationNs) / 1_000_000;
    const level = resolveLogLevel(res.statusCode);
    const statusCode = res.statusCode;
    const formattedDuration = formatDuration(durationMs);
    const durationBar = getDurationBar(durationMs);

    // Log response to terminal with colors and duration bar
    const coloredStatus = getColoredStatus(statusCode);
    console.log(
      `${coloredStatus} \x1b[2m${method} ${path}\x1b[0m ${durationBar} \x1b[90m(${formattedDuration})\x1b[0m`
    );

    // If it's an error response, display error box
    if (statusCode >= 400 && res.locals?.errorMessage) {
      displayErrorBox(res.locals.errorMessage, statusCode, path);
    }

    // If it's a success response with OTP, display OTP box
    if (requestBody && statusCode === 200 && res.locals?.otp) {
      displayOtpBox(requestBody.phone, res.locals.otp, otpPurpose);
    }

    // If it's a success response with critical operation, display success box
    if (statusCode === 200 && res.locals?.successMessage) {
      displaySuccessBox(res.locals.successMessage, res.locals.successDetails);
    }

    // Rebuild child with auth context for structured logs
    const responseLog = logger.child({
      requestId: reqId,
      ip,
      userId: req.userId ?? undefined,
      role: req.role ?? undefined,
    });

    responseLog[level](
      {
        type: 'response',
        method: req.method,
        url: sanitizeUrl(req.originalUrl),
        statusCode: res.statusCode,
        durationMs: Math.round(durationMs * 100) / 100,
        contentLen: res.getHeader('content-length') ?? 0,
        userId: req.userId ?? undefined,
        schoolId: req.schoolId ?? undefined,
        ...(isEmergencyRoute(req) && {
          scanAudit: {
            tokenHash: req.params?.token,
            scanIp: ip,
            userAgent: req.headers['user-agent'],
          },
        }),
      },
      `← ${res.statusCode} ${req.method} ${req.path} ${Math.round(durationMs)}ms`
    );
  });

  // Capture OTP and success messages from service response (monkey patch send method)
  const originalJson = res.json;
  res.json = function (data) {
    // Capture OTP if present in response (for development only)
    if (process.env.NODE_ENV !== 'production' && data?.devCode) {
      res.locals.otp = data.devCode;
    }
    // Capture error message
    if (!data?.success && data?.message) {
      res.locals.errorMessage = data.message;
    }
    // Capture success message for critical operations
    if (data?.success && data?.message && data?.critical) {
      res.locals.successMessage = data.message;
      res.locals.successDetails = data?.details;
    }
    return originalJson.call(this, data);
  };

  res.on('error', err => {
    req.log.error({ type: 'response_error', err }, 'Response stream error');
  });

  next();
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function resolveLogLevel(statusCode) {
  if (statusCode >= 500) return 'error';
  if (statusCode >= 400) return 'warn';
  return 'info';
}

function sanitizeHeaders(headers) {
  const safe = {};
  for (const [key, value] of Object.entries(headers)) {
    safe[key] = SENSITIVE_HEADERS.has(key.toLowerCase()) ? REDACTED : value;
  }
  return safe;
}

function sanitizeBody(body) {
  if (!body || typeof body !== 'object') return body;

  const safe = {};
  for (const [key, value] of Object.entries(body)) {
    if (SENSITIVE_BODY_KEYS.has(key.toLowerCase())) {
      safe[key] = REDACTED;
    } else if (typeof value === 'object' && value !== null) {
      safe[key] = sanitizeBody(value);
    } else {
      safe[key] = value;
    }
  }
  return safe;
}

function sanitizeUrl(url) {
  try {
    const u = new URL(url, 'http://localhost');
    for (const key of ['token', 'key', 'secret', 'password']) {
      if (u.searchParams.has(key)) u.searchParams.set(key, REDACTED);
    }
    return u.pathname + (u.search || '');
  } catch {
    return url;
  }
}

function shouldLogBody(req) {
  if (!ELEVATED_LOG_ROUTES.has(req.path)) return false;
  const contentLen = parseInt(req.headers['content-length'] ?? '0', 10);
  return contentLen < 10_000;
}

function isEmergencyRoute(req) {
  return req.path.startsWith('/api/emergency');
}
