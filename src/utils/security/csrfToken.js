// =============================================================================
// csrfToken.js — RESQID
// CSRF token generation and verification utilities
// Used by csrf.middleware.js — double-submit cookie pattern
// Stateless — no Redis/DB needed
// =============================================================================

import crypto from 'crypto';
import { ENV } from '#config/env.js';

const TOKEN_BYTES = 32;
const SEPARATOR = '.';
const COOKIE_NAME = '__Host-csrf';
const HEADER_NAME = 'x-csrf-token';
const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ─── Generate ─────────────────────────────────────────────────────────────────

/**
 * generateCsrfToken()
 * Creates a random token + its HMAC signature
 * Caller stores "token.signature" in cookie, sends "token" in header
 *
 * @returns {{ token: string, cookieValue: string }}
 */
export function generateCsrfToken() {
  const token = crypto.randomBytes(TOKEN_BYTES).toString('hex');
  const signature = signCsrfToken(token);

  return {
    token, // sent as header value (X-CSRF-Token)
    cookieValue: `${token}${SEPARATOR}${signature}`, // stored in cookie
  };
}

// ─── Sign / Verify ────────────────────────────────────────────────────────────

export function signCsrfToken(token) {
  if (!ENV.CSRF_SECRET) throw new Error('CSRF_SECRET not set');
  return crypto.createHmac('sha256', ENV.CSRF_SECRET).update(token).digest('hex');
}

/**
 * verifyCsrfPair(headerToken, cookieValue)
 * Returns true only if:
 *   1. Cookie format is valid (token.signature)
 *   2. Header token matches cookie token
 *   3. Signature is valid (proves we issued the cookie)
 */
export function verifyCsrfPair(headerToken, cookieValue) {
  if (!headerToken || !cookieValue) return false;

  const parts = cookieValue.split(SEPARATOR);
  if (parts.length !== 2) return false;

  const [cookieToken, cookieSignature] = parts;

  // Token in header must match token in cookie
  if (cookieToken !== headerToken) return false;

  // Verify HMAC signature — proves cookie was issued by our server
  const expectedSignature = signCsrfToken(cookieToken);

  try {
    return crypto.timingSafeEqual(Buffer.from(cookieSignature), Buffer.from(expectedSignature));
  } catch {
    return false;
  }
}

// ─── Cookie Helpers ───────────────────────────────────────────────────────────

export function setCsrfCookie(res, cookieValue) {
  res.cookie(COOKIE_NAME, cookieValue, {
    httpOnly: false, // MUST be false — JS needs to read it
    secure: ENV.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: TTL_MS,
    path: '/',
  });
}

export function clearCsrfCookie(res) {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: false,
    secure: ENV.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
  });
}

export { COOKIE_NAME as CSRF_COOKIE_NAME, HEADER_NAME as CSRF_HEADER_NAME };
