// =============================================================================
// utils/security/ssrf.js
//
// FIX 4 — SSRF (Server-Side Request Forgery) Protection
// =============================================================================
// PROBLEM:  Your system makes outbound HTTP calls based on user-supplied URLs:
//             - Webhook delivery (user registers a webhook URL)
//             - Any future avatar/image URL fetching
//
//           An attacker supplies: http://169.254.169.254/latest/meta-data/
//           Your server fetches it → returns AWS IAM credentials to attacker.
//           This is how many major cloud breaches happen.
//
// SOLUTION: validateOutboundUrl(url) — call this BEFORE any user-supplied URL
//           is fetched. It blocks:
//             - Private IPv4 ranges (RFC 1918): 10.x, 172.16-31.x, 192.168.x
//             - Loopback: 127.x, ::1
//             - Link-local (AWS metadata): 169.254.x.x
//             - Cloud metadata endpoints by hostname
//             - Non-HTTP(S) schemes
//
// USAGE:
//   import { validateOutboundUrl } from '#utils/security/ssrf.js';
//
//   // In webhook.service.js before delivering:
//   validateOutboundUrl(webhook.url); // throws ApiError if blocked
//   await fetch(webhook.url, { ... });
//
//   // In any service that fetches a user-supplied URL:
//   validateOutboundUrl(req.body.avatarUrl);
// =============================================================================

import dns from 'dns/promises';
import { ApiError } from './response/ApiError.js';

// Private/reserved IP ranges that must never be reached from server
const BLOCKED_IP_PATTERNS = [
  /^127\./, // Loopback
  /^10\./, // RFC 1918 private
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // RFC 1918 private
  /^192\.168\./, // RFC 1918 private
  /^169\.254\./, // Link-local (AWS metadata endpoint lives here)
  /^0\./, // 'This' network
  /^100\.(6[4-9]|[7-9][0-9]|1[0-1][0-9]|12[0-7])\./, // CGNAT
  /^::1$/, // IPv6 loopback
  /^fc00:/, // IPv6 unique local
  /^fe80:/, // IPv6 link-local
];

// Known cloud metadata hostnames — block by name even if IP is unknown
const BLOCKED_HOSTNAMES = [
  'metadata.google.internal', // GCP
  '169.254.169.254', // AWS / Azure / GCP metadata IP
  'metadata.azure.internal', // Azure
  'instance-data', // old AWS
];

// Only allow these URL schemes — no file://, ftp://, gopher://, etc.
const ALLOWED_SCHEMES = ['http:', 'https:'];

// =============================================================================
// Synchronous URL structure check (fast path — no DNS lookup)
// Call this first; if it passes, call validateOutboundUrlWithDns for full check
// =============================================================================
export function validateOutboundUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new ApiError(400, 'Invalid URL format');
  }

  // Block non-HTTP schemes
  if (!ALLOWED_SCHEMES.includes(parsed.protocol)) {
    throw new ApiError(400, `URL scheme '${parsed.protocol}' is not allowed`);
  }

  const hostname = parsed.hostname.toLowerCase();

  // Block known metadata hostnames
  if (BLOCKED_HOSTNAMES.includes(hostname)) {
    throw new ApiError(400, 'URL points to a blocked internal endpoint');
  }

  // Block if hostname looks like a raw IP in a blocked range
  if (isBlockedIp(hostname)) {
    throw new ApiError(400, 'URL resolves to a blocked IP range');
  }

  // Block localhost variants
  if (hostname === 'localhost' || hostname === '0.0.0.0') {
    throw new ApiError(400, 'URL points to a blocked internal endpoint');
  }

  return parsed; // Return parsed URL for convenience
}

// =============================================================================
// Async DNS-resolution check (full protection)
// Use this before actually making the outbound HTTP request
// Resolves hostname → checks all resolved IPs against blocked ranges
// This catches SSRF via DNS rebinding attacks
// =============================================================================
export async function validateOutboundUrlWithDns(rawUrl) {
  const parsed = validateOutboundUrl(rawUrl); // sync check first

  const hostname = parsed.hostname;

  // Skip DNS check for raw IPs (already checked above)
  // Only do DNS resolution for hostnames
  if (!isIpAddress(hostname)) {
    try {
      const addresses = await dns.resolve4(hostname); // resolve to IPv4
      for (const ip of addresses) {
        if (isBlockedIp(ip)) {
          throw new ApiError(400, `URL hostname '${hostname}' resolves to a blocked IP address`);
        }
      }
    } catch (err) {
      if (err instanceof ApiError) throw err;
      // DNS resolution failed — block the request
      // Don't reveal why (could help attacker tune their payload)
      throw new ApiError(400, 'URL validation failed');
    }
  }

  return parsed;
}

// =============================================================================
// Helpers
// =============================================================================

function isBlockedIp(ip) {
  return BLOCKED_IP_PATTERNS.some(pattern => pattern.test(ip));
}

function isIpAddress(str) {
  // Simple check: does it look like an IPv4 or IPv6 address?
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(str) || str.includes(':');
}

// =============================================================================
// utils/security/hashUtil.js
//
// FIX 5 — Timing-safe comparisons
// =============================================================================
// PROBLEM:  JavaScript string comparison (===) is NOT constant-time.
//           It short-circuits on the first character mismatch.
//           An attacker can measure response times to guess secrets
//           one byte at a time — known as a "timing attack".
//
//           Vulnerable example:
//             if (req.body.apiKey === storedApiKey) { ... }
//
//           "a..." vs "correctkey" → fails on char 0 → fast response
//           "c...' vs 'correctkey' → fails on char 1 → slightly slower
//           ... attacker narrows down each character
//
// SOLUTION: crypto.timingSafeEqual() from Node's built-in crypto module.
//           Always takes the same amount of time regardless of where
//           the strings differ.
//
// USE timingSafeCompare FOR:
//   ✓ API key verification
//   ✓ CSRF token comparison
//   ✓ Webhook HMAC signature verification
//   ✓ Registration nonce verification
//   ✓ Any secret comparison that isn't bcrypt
//
// DO NOT USE FOR:
//   ✗ OTP codes → use bcrypt.compare() (already timing-safe + hashed)
//   ✗ Passwords → use bcrypt.compare()
// =============================================================================

import crypto from 'crypto';
import bcrypt from 'bcrypt';

const BCRYPT_ROUNDS = 12;

// =============================================================================
// FIX 5 — Timing-safe string comparison
// Both inputs must be the same length — if lengths differ, returns false
// immediately (length itself leaks no useful info about the secret)
// =============================================================================
export function timingSafeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;

  // Inputs must be same byte length for timingSafeEqual
  // If lengths differ: we know they don't match, but we still do the
  // comparison to avoid leaking the length as timing info
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');

  if (bufA.length !== bufB.length) {
    // Do a dummy comparison to consume similar time, then return false
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }

  return crypto.timingSafeEqual(bufA, bufB);
}

// =============================================================================
// Hash a secret token for storage (SHA-256)
// Use for: refresh tokens, API keys, nonces — things you store hashed
// and later compare with timingSafeCompare(incoming, stored)
// =============================================================================
export function hashToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

// =============================================================================
// Compare a raw token against its stored SHA-256 hash
// Timing-safe — wraps timingSafeCompare
// =============================================================================
export function verifyTokenHash(rawToken, storedHash) {
  const incomingHash = hashToken(rawToken);
  return timingSafeCompare(incomingHash, storedHash);
}

// =============================================================================
// Hash a password with bcrypt
// =============================================================================
export async function hashPassword(plainText) {
  return bcrypt.hash(plainText, BCRYPT_ROUNDS);
}

// =============================================================================
// Verify a password against bcrypt hash
// bcrypt.compare is already timing-safe internally
// =============================================================================
export async function verifyPassword(plainText, hash) {
  return bcrypt.compare(plainText, hash);
}

// =============================================================================
// Generate HMAC-SHA256 signature (for webhooks)
// Usage: signWebhookPayload(JSON.stringify(payload), webhookSecret)
// =============================================================================
export function signWebhookPayload(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

// =============================================================================
// Verify webhook signature — TIMING SAFE
// Compare incoming signature against expected HMAC
// =============================================================================
export function verifyWebhookSignature(payload, incomingSignature, secret) {
  const expectedSignature = signWebhookPayload(payload, secret);
  return timingSafeCompare(incomingSignature, expectedSignature);
}

// =============================================================================
// middleware/registrationNonce.middleware.js
//
// FIX 3 — Registration Nonce
// =============================================================================
// PROBLEM:  Without a nonce, bots can POST /register in a tight loop and
//           create thousands of accounts, exhausting OTP SMS credits and
//           flooding your DB.
//
// SOLUTION: Two-step registration:
//   Step 1: Client calls GET /api/v1/auth/nonce
//           Server generates a random nonce, stores in Redis (TTL 10min)
//           Returns nonce to client
//
//   Step 2: Client includes nonce in POST /api/v1/auth/register body
//           This middleware verifies + deletes the nonce (one-time use)
//           If nonce missing, wrong, or expired → 400
//
// WHY THIS WORKS:
//   Bots hammering /register directly without going through /nonce first
//   will get 400 on every attempt. They"d need to call /nonce per attempt,
//   which is rate-limited separately (5/min/IP), making mass registration
//   prohibitively slow.
//
// ADD TO ROUTES:
//   router.get("/nonce', issueRegistrationNonce);         ← rate limited 5/min
//   router.post('/register', requireRegistrationNonce, registerHandler);
// =============================================================================

import { redis } from '#config/database/redis.js';
import { timingSafeCompare, hashToken } from '#utils/security/hashUtil.js';
import { ApiError } from '#utils/response/ApiError.js';
import { v4 as uuidv4 } from 'uuid';

const NONCE_TTL_SECONDS = 10 * 60; // 10 minutes
const NONCE_PREFIX = 'reg_nonce:';

// =============================================================================
// Route handler: GET /api/v1/auth/nonce
// Issues a one-time registration nonce
// Rate limit this route to 5 req/min/IP in your route file
// =============================================================================
export async function issueRegistrationNonce(req, res) {
  const nonce = uuidv4(); // 128-bit random
  const hashedNonce = hashToken(nonce); // store hash, return raw

  // Key includes IP so nonces can't be shared across IPs
  const key = `${NONCE_PREFIX}${req.ip}:${hashedNonce}`;
  await redis.setEx(key, NONCE_TTL_SECONDS, '1');

  return res.status(200).json({
    success: true,
    data: { nonce }, // client must include this in /register body
    expiresInSeconds: NONCE_TTL_SECONDS,
  });
}

// =============================================================================
// Middleware: requireRegistrationNonce
// Validates nonce on POST /register before it reaches the handler
// =============================================================================
export async function requireRegistrationNonce(req, res, next) {
  const { nonce } = req.body;

  if (!nonce || typeof nonce !== 'string') {
    throw new ApiError(400, 'Registration nonce is required');
  }

  const hashedNonce = hashToken(nonce);
  const key = `${NONCE_PREFIX}${req.ip}:${hashedNonce}`;

  // Check Redis — nonce must exist (not expired, not already used)
  const exists = await redis.get(key);

  if (!exists) {
    // Don't reveal whether it expired or was never issued
    throw new ApiError(400, 'Invalid or expired registration token. Please restart registration.');
  }

  // DELETE immediately — one-time use only
  // If two concurrent requests come in with the same nonce,
  // only the first DEL succeeds (Redis is single-threaded)
  const deleted = await redis.del(key);
  if (deleted === 0) {
    // Another concurrent request already consumed this nonce
    throw new ApiError(400, 'Registration token already used');
  }

  // Nonce is valid and consumed — proceed to registration handler
  next();
}
