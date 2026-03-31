// =============================================================================
// csrf.middleware.js — RESQID
// Double-submit cookie pattern — stateless, Redis-free, works with mobile
// Public emergency API is EXEMPT (read-only GET, no state mutation)
// Mobile app uses custom header method (no cookies on native apps)
// =============================================================================

import crypto from 'crypto';
import { ApiError } from '#shared/response/ApiError.js';
import { asyncHandler } from '#shared/response/asyncHandler.js';
import { ENV } from '#config/env.js';

// ─── Constants ────────────────────────────────────────────────────────────────
const CSRF_COOKIE = '__Host-csrf'; // __Host- prefix = most secure cookie flag
const CSRF_HEADER = 'x-csrf-token';
const TOKEN_BYTES = 32;
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Methods that mutate state — must be protected
const PROTECTED_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Routes exempt from CSRF — public or pre-auth endpoints
// FIX [#4]: Clarified exemption reasons per endpoint:
//   /api/emergency  — public read-only GET, no cookies, no mutation
//   /api/auth/otp   — pre-authentication (no session cookie exists yet at OTP
//                     send/verify time, so double-submit pattern cannot apply;
//                     brute-force is handled by authLimiter + otpLimiter instead)
const EXEMPT_PREFIXES = [
  '/api/emergency', // public QR scan — GET only, no mutation
  '/api/auth/otp', // pre-auth — no session cookie exists yet; rate-limited separately
];

// ─── CSRF Token Generation ────────────────────────────────────────────────────

function generateToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString('hex');
}

function signToken(token) {
  return crypto.createHmac('sha256', ENV.CSRF_SECRET).update(token).digest('hex');
}

function verifyToken(token, signature) {
  const expected = signToken(token);
  // Timing-safe comparison — prevents timing attacks
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

// ─── Issue CSRF Token ─────────────────────────────────────────────────────────

/**
 * issueCsrfToken
 * Called on login success — sets signed CSRF cookie
 * Frontend must read this cookie and send value in X-CSRF-Token header
 */
export function issueCsrfToken(res) {
  const token = generateToken();
  const signature = signToken(token);
  const payload = `${token}.${signature}`;

  res.cookie(CSRF_COOKIE, payload, {
    httpOnly: false, // Must be readable by JS — by design
    secure: ENV.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: TOKEN_TTL_MS,
    path: '/',
    // __Host- prefix enforced by cookie name — browser handles it
  });

  return token;
}

/**
 * clearCsrfToken
 * Called on logout — invalidate cookie immediately
 */
export function clearCsrfToken(res) {
  res.clearCookie(CSRF_COOKIE, {
    httpOnly: false,
    secure: ENV.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
  });
}

// ─── CSRF Verification Middleware ─────────────────────────────────────────────

/**
 * verifyCsrf
 * Applied to all dashboard routes (school admin + super admin)
 * Mobile app sends JWT only — CSRF not required on mobile (no cookies)
 *
 * Strategy: Double-submit cookie
 *   Cookie value: "token.signature"
 *   Header value: "token"
 *   Server re-signs header token and compares to cookie signature
 */
export const verifyCsrf = asyncHandler(async (req, _res, next) => {
  // Skip safe methods
  if (!PROTECTED_METHODS.has(req.method)) return next();

  // Skip exempt routes
  if (EXEMPT_PREFIXES.some(prefix => req.path.startsWith(prefix))) return next();

  // Mobile app — identified by role or missing cookie
  // Mobile clients authenticate via JWT Bearer only — no CSRF needed
  const isMobileApp =
    req.headers['x-client-type'] === 'mobile' || req.headers['user-agent']?.includes('Resqid');
  if (req.role === 'PARENT_USER' && isMobileApp) return next();
  const cookieValue = req.cookies?.[CSRF_COOKIE];
  const headerValue = req.headers[CSRF_HEADER];

  if (!cookieValue) {
    throw ApiError.forbidden('CSRF cookie missing');
  }
  if (!headerValue) {
    throw ApiError.forbidden('CSRF token header missing');
  }

  const [cookieToken, cookieSignature] = cookieValue.split('.');

  if (!cookieToken || !cookieSignature) {
    throw ApiError.forbidden('CSRF cookie malformed');
  }

  // Header token must match cookie token
  if (cookieToken !== headerValue) {
    throw ApiError.forbidden('CSRF token mismatch');
  }

  // Verify signature — proves cookie was issued by us
  let valid = false;
  try {
    valid = verifyToken(cookieToken, cookieSignature);
  } catch {
    throw ApiError.forbidden('CSRF token verification failed');
  }

  if (!valid) {
    throw ApiError.forbidden('CSRF token signature invalid');
  }

  next();
});

/**
 * verifyCsrfMobile
 * For mobile app routes — CSRF not applicable but validate no cookie present
 * Ensures mobile tokens aren"t accidentally sent with cookie credentials
 */
export const verifyCsrfMobile = asyncHandler(async (req, _res, next) => {
  // Mobile app should NOT send CSRF cookies — if it does, something is wrong
  if (req.cookies?.[CSRF_COOKIE] && req.role === 'PARENT_USER') {
    // Log anomaly but don"t block — cookie may be stale
    req.log?.warn({ userId: req.userId }, 'CSRF cookie present on mobile request');
  }
  next();
});
