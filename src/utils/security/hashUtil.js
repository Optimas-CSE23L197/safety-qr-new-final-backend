// =============================================================================
// hashUtil.js — RESQID
// All hashing operations in one place — never scattered across the codebase
//
// Bcrypt   → passwords (adaptive cost factor, slow by design)
// SHA-256  → token_hash, otp_hash, blacklist_token (fast lookups)
// HMAC     → phone_index (deterministic, searchable) — see encryption.js
// =============================================================================

import bcrypt from 'bcrypt';
import crypto from 'crypto';

// ─── Bcrypt — Password Hashing ────────────────────────────────────────────────
// Cost factor 12 = ~300ms on modern hardware — right balance for production
// Increase to 13-14 on faster servers

const BCRYPT_ROUNDS = 12;

/**
 * hashPassword(plaintext)
 * Always use this — never raw bcrypt.hash()
 * Returns bcrypt hash string — safe to store in DB
 */
export async function hashPassword(plaintext) {
  if (!plaintext || typeof plaintext !== 'string') {
    throw new TypeError('hashPassword: plaintext must be a non-empty string');
  }
  // Bcrypt silently truncates at 72 bytes — reject longer passwords
  if (Buffer.byteLength(plaintext, 'utf8') > 72) {
    throw new Error('Password exceeds maximum length (72 bytes)');
  }
  return bcrypt.hash(plaintext, BCRYPT_ROUNDS);
}

/**
 * verifyPassword(plaintext, hash)
 * Timing-safe — bcrypt.compare is already constant-time
 * Returns boolean — NEVER throw on mismatch, just return false
 */
export async function verifyPassword(plaintext, hash) {
  if (!plaintext || !hash) return false;
  try {
    return await bcrypt.compare(plaintext, hash);
  } catch {
    return false;
  }
}

// ─── SHA-256 Hashing — Tokens and OTPs ───────────────────────────────────────

/**
 * hashToken(rawToken)
 * SHA-256 of raw token — store this in DB, never the raw value
 * Used for: token_hash, refresh_token_hash, blacklist keys
 *
 * @param   {string} rawToken
 * @returns {string} 64-char hex
 */
export function hashToken(rawToken) {
  if (!rawToken || typeof rawToken !== 'string') {
    throw new TypeError('hashToken: rawToken must be a non-empty string');
  }
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

/**
 * hashOtp(otp)
 * SHA-256 of OTP — stored in OtpLog, never plaintext
 * OTP should always be a numeric string
 */
export function hashOtp(otp) {
  if (!otp) throw new TypeError('hashOtp: otp must be provided');
  return crypto.createHash('sha256').update(String(otp)).digest('hex');
}

// ─── Timing-Safe Comparison ───────────────────────────────────────────────────

/**
 * timingSafeEqual(a, b)
 * Constant-time string comparison — prevents timing attacks on hash comparison
 * Use this for CSRF tokens, API keys — NOT for passwords (use bcrypt)
 *
 * @returns {boolean}
 */
export function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;

  try {
    // Buffers must be same length for timingSafeEqual
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);

    if (bufA.length !== bufB.length) return false;

    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

// ─── Random Generation ────────────────────────────────────────────────────────

/**
 * generateSecureToken()
 * 256-bit cryptographically secure random token
 * Used for: raw JWT refresh tokens, QR tokens before hashing
 * @returns {string} 64-char hex
 */
export function generateSecureToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * generateOtp(length = 6)
 * Cryptographically secure numeric OTP
 * Avoids Math.random() which is NOT cryptographically secure
 */
export function generateOtp(length = 6) {
  const max = Math.pow(10, length);
  // Generate random bytes and convert to number
  const randomValue = crypto.randomInt(0, max);
  return String(randomValue).padStart(length, '0');
}

/**
 * generateNonce(bytes = 16)
 * Short random hex nonce for CSRF, idempotency keys
 */
export function generateNonce(bytes = 16) {
  return crypto.randomBytes(bytes).toString('hex');
}
