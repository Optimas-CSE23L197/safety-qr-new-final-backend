// =============================================================================
// jwt.js — RESQID
// JWT access + refresh token management for all 3 user types:
//   PARENT_USER, ADMIN, SUPER_ADMIN
//
// Access token  — short-lived (15min), stateless verification
// Refresh token — long-lived (30d), stored as hash in Session table
// Single-device: issuing new refresh token revokes all other sessions
// =============================================================================

import jwt from "jsonwebtoken";
import { randomUUID } from "crypto"; // built-in — no extra dependency needed
import { ENV } from "../../config/env.js";
import { hashToken, generateSecureToken } from "./hashUtil.js";

// ─── Token Config per role ────────────────────────────────────────────────────
const TOKEN_CONFIG = {
  PARENT_USER: {
    accessTTL: "15m",
    refreshTTL: "30d",
    refreshTTLms: 30 * 24 * 60 * 60 * 1000,
  },
  ADMIN: {
    accessTTL: "1h",
    refreshTTL: "7d",
    refreshTTLms: 7 * 24 * 60 * 60 * 1000,
  },
  SUPER_ADMIN: {
    accessTTL: "30m",
    refreshTTL: "24h",
    refreshTTLms: 24 * 60 * 60 * 1000,
  },
};

const BASE_OPTIONS = {
  issuer: "resqid",
  audience: "resqid-api",
};

// ─── Access Token ─────────────────────────────────────────────────────────────

/**
 * signAccessToken({ userId, role, sessionId, schoolId? })
 *
 * FIX 1 — now stamps jti (JWT ID) on every token.
 * jti is a unique ID per token — required for blacklisting on logout/revoke.
 * Without jti, you can only invalidate ALL tokens for a user, not one specific token.
 *
 * @returns {{ token: string, jti: string }}
 *   token — signed JWT to send to client
 *   jti   — store this in Session record so it can be blacklisted on logout
 */
export function signAccessToken({ userId, role, sessionId, schoolId = null }) {
  const config = TOKEN_CONFIG[role];
  if (!config) throw new Error(`signAccessToken: unknown role '${role}'`);

  // FIX 1: unique ID per token — this is the blacklist key
  const jti = randomUUID();

  const token = jwt.sign(
    {
      sub: userId,
      role,
      sessionId,
      jti, // ← FIX 1: added
      ...(schoolId && { schoolId }),
    },
    ENV.JWT_ACCESS_SECRET,
    {
      ...BASE_OPTIONS,
      algorithm: "HS256",
      expiresIn: config.accessTTL,
    },
  );

  // Return both so callers can store jti in the Session record
  return { token, jti };
}

/**
 * verifyAccessToken(token)
 * Returns payload or throws typed error
 */
export function verifyAccessToken(token) {
  return jwt.verify(token, ENV.JWT_ACCESS_SECRET, {
    ...BASE_OPTIONS,
    algorithms: ["HS256"], // explicit — reject any other algorithm
  });
}

// ─── FIX 1 — Token Blacklist (Redis) ─────────────────────────────────────────
// After logout or forced revocation, the access token's jti is stored in Redis
// with a TTL equal to the token's remaining lifetime.
// auth.middleware.js checks this on every authenticated request.
//
// Redis key pattern: blacklist:{jti}
// TTL: remaining seconds until token naturally expires (auto-cleanup)
//
// Why TTL = remaining lifetime?
//   The token is already expired after its TTL — no need to keep the blacklist
//   entry forever. Redis auto-deletes it, keeping the blacklist set lean.

/**
 * blacklistToken(jti, remainingTtlSeconds)
 * Call on: logout, password change, forced revoke, suspicious activity
 */
export async function blacklistToken(jti, remainingTtlSeconds) {
  // Lazy import to avoid circular dependency at module load time
  const { redis } = await import("../../config/redis.js");
  const ttl = Math.max(Math.ceil(remainingTtlSeconds), 1);
  await redis.setEx(`blacklist:${jti}`, ttl, "1");
}

/**
 * isTokenBlacklisted(jti)
 * Called in auth.middleware.js AFTER verifyAccessToken succeeds.
 * A valid signature is not enough — the token must also not be blacklisted.
 * @returns {boolean}
 */
export async function isTokenBlacklisted(jti) {
  const { redis } = await import("../../config/redis.js");
  const result = await redis.get(`blacklist:${jti}`);
  return result !== null;
}

/**
 * getRemainingTtlSeconds(decodedPayload)
 * Calculates how many seconds remain before this token expires.
 * Pass to blacklistToken() so the Redis key auto-expires correctly.
 */
export function getRemainingTtlSeconds(decodedPayload) {
  if (!decodedPayload?.exp) return 0;
  return Math.max(decodedPayload.exp - Math.floor(Date.now() / 1000), 0);
}

// ─── Refresh Token ────────────────────────────────────────────────────────────

/**
 * issueRefreshToken(role)
 * Generates raw token + its hash
 * Store ONLY the hash in DB — send raw token to client
 *
 * @returns {{ raw: string, hash: string, expiresAt: Date }}
 */
export function issueRefreshToken(role) {
  const config = TOKEN_CONFIG[role];
  if (!config) throw new Error(`issueRefreshToken: unknown role '${role}'`);

  const raw = generateSecureToken(); // 256-bit random
  const hash = hashToken(raw);
  const expiresAt = new Date(Date.now() + config.refreshTTLms);

  return { raw, hash, expiresAt };
}

/**
 * hashRefreshToken(rawToken)
 * Hash an incoming refresh token for DB lookup
 */
export function hashRefreshToken(rawToken) {
  return hashToken(rawToken);
}

/**
 * getRefreshTokenTTL(role)
 * Returns TTL in milliseconds — used when setting cookie maxAge
 */
export function getRefreshTokenTTL(role) {
  return (
    TOKEN_CONFIG[role]?.refreshTTLms ?? TOKEN_CONFIG.PARENT_USER.refreshTTLms
  );
}

// ─── Token Pair ───────────────────────────────────────────────────────────────

/**
 * issueTokenPair({ userId, role, sessionId, schoolId? })
 * Issues both access + refresh token in one call.
 * Used after successful login or token refresh.
 *
 * @returns {{
 *   accessToken:  string,   ← send in response body
 *   jti:          string,   ← store in Session.access_token_jti (for blacklisting)
 *   refreshToken: string,   ← send in httpOnly cookie
 *   refreshHash:  string,   ← store in Session.refresh_token_hash
 *   expiresAt:    Date,     ← Session.expires_at
 * }}
 */
export function issueTokenPair({ userId, role, sessionId, schoolId = null }) {
  // FIX 1: destructure { token, jti } — both are needed by session.service.js
  const { token: accessToken, jti } = signAccessToken({
    userId,
    role,
    sessionId,
    schoolId,
  });
  const {
    raw: refreshToken,
    hash: refreshHash,
    expiresAt,
  } = issueRefreshToken(role);

  // jti must be stored in Session record so logout can blacklist this specific token
  return { accessToken, jti, refreshToken, refreshHash, expiresAt };
}

// ─── Cookie Helper ────────────────────────────────────────────────────────────

/**
 * setRefreshCookie(res, rawRefreshToken, role)
 * Sets refresh token as secure httpOnly cookie
 * Cookie name: __Host-refresh — most secure prefix
 */
export function setRefreshCookie(res, rawRefreshToken, role) {
  const ttlMs = getRefreshTokenTTL(role);
  res.cookie("__Host-refresh", rawRefreshToken, {
    httpOnly: true,
    secure: ENV.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: ttlMs,
    path: "/api/auth/refresh", // scope cookie to refresh endpoint only
  });
}

/**
 * clearRefreshCookie(res)
 */
export function clearRefreshCookie(res) {
  res.clearCookie("__Host-refresh", {
    httpOnly: true,
    secure: ENV.NODE_ENV === "production",
    sameSite: "strict",
    path: "/api/auth/refresh",
  });
}

// ─── Decode Without Verify ────────────────────────────────────────────────────

/**
 * decodeToken(token)
 * Decode without verification — only for debugging or logging
 * NEVER use the result to make access decisions
 */
export function decodeToken(token) {
  return jwt.decode(token);
}
