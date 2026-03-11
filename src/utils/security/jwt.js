// =============================================================================
// jwt.js — RESQID
// JWT access + refresh token management for all 3 user types:
//   PARENT_USER, SCHOOL_USER, SUPER_ADMIN
//
// Access token  — short-lived (15min), stateless verification
// Refresh token — long-lived (30d), stored as hash in Session table
// Single-device: issuing new refresh token revokes all other sessions
// =============================================================================

import jwt from "jsonwebtoken";
import { ENV } from "../../config/env.js";
import { hashToken, generateSecureToken } from "./hashUtil.js";

// ─── Token Config per role ────────────────────────────────────────────────────
const TOKEN_CONFIG = {
  PARENT_USER: {
    accessTTL: "15m",
    refreshTTL: "30d",
    refreshTTLms: 30 * 24 * 60 * 60 * 1000,
  },
  SCHOOL_USER: {
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
 * @returns {string} signed JWT
 */
export function signAccessToken({ userId, role, sessionId, schoolId = null }) {
  const config = TOKEN_CONFIG[role];
  if (!config) throw new Error(`signAccessToken: unknown role '${role}'`);

  return jwt.sign(
    {
      sub: userId,
      role,
      sessionId,
      ...(schoolId && { schoolId }),
    },
    ENV.JWT_ACCESS_SECRET,
    {
      ...BASE_OPTIONS,
      algorithm: "HS256",
      expiresIn: config.accessTTL,
    },
  );
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
 * Issues both access + refresh token in one call
 * Used after successful login or token refresh
 *
 * @returns {{
 *   accessToken:  string,   ← send in response body
 *   refreshToken: string,   ← send in httpOnly cookie
 *   refreshHash:  string,   ← store in Session.refresh_token_hash
 *   expiresAt:    Date,     ← Session.expires_at
 * }}
 */
export function issueTokenPair({ userId, role, sessionId, schoolId = null }) {
  const accessToken = signAccessToken({ userId, role, sessionId, schoolId });
  const {
    raw: refreshToken,
    hash: refreshHash,
    expiresAt,
  } = issueRefreshToken(role);

  return { accessToken, refreshToken, refreshHash, expiresAt };
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
