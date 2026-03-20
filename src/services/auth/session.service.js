// =============================================================================
// services/auth/session.service.js
//
// FIX 2 — Refresh token reuse detection
// =============================================================================
// PROBLEM:  Token rotation alone is not enough.
//
//           Normal rotation flow:
//             Client sends refresh token R1
//             Server issues new R2, invalidates R1
//             Client uses R2 next time ✓
//
//           Attack scenario (token theft):
//             Attacker steals R1 before client uses it
//             Attacker sends R1 first → gets R2
//             Legitimate client sends R1 → gets 401 (already rotated)
//             Attacker now has R2 and ongoing access
//             Legitimate user just gets confusing errors
//
//           WITH REUSE DETECTION:
//             Legitimate client sends R1 → gets R2, R1 marked USED
//             Attacker (or legitimate client again) sends R1 → R1 is USED
//             Server detects reuse → WIPE ALL SESSIONS for this user
//             Both attacker and user are forced to re-login
//             User sees "suspicious activity" message → knows to change password
//
// IMPLEMENTATION:
//   Token table stores: token (hashed), userId, status (ACTIVE|USED|REVOKED),
//   replacedByToken (hash of successor), deviceId, expiresAt
//
//   refreshToken(rawToken):
//     1. Hash raw token
//     2. Look up in DB
//     3. If status = USED → reuse detected → wipeAllSessions → throw 401
//     4. If status = REVOKED or expired → throw 401
//     5. Mark current token as USED
//     6. Issue new token, store with status = ACTIVE
//     7. Link: old.replacedByToken = new token hash
// =============================================================================

import { prisma } from "../../config/prisma.js";
import { redis } from "../../config/redis.js";
import {
  generateRefreshToken,
  signAccessToken,
  blacklistToken,
} from "../../utils/security/jwt.js";
import { hashToken } from "../../utils/security/hashUtil.js";
import { ApiError } from "../../utils/response/ApiError.js";
import { logger } from "../../config/logger.js";

const REFRESH_TOKEN_TTL_DAYS = 30;

// =============================================================================
// Create a new session (called on login / OTP verify)
// Stores refresh token hashed in DB + session record in Redis
// Returns { accessToken, refreshToken } — caller sets httpOnly cookie
// =============================================================================
export async function createSession(userId, role, deviceId, ipAddress) {
  // Issue access token with jti
  const { token: accessToken, jti } = signAccessToken({ userId, role });

  // Issue opaque refresh token
  const rawRefreshToken = generateRefreshToken();
  const hashedRefreshToken = hashToken(rawRefreshToken); // SHA-256

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_TTL_DAYS);

  // Store refresh token in DB
  await prisma.token.create({
    data: {
      token: hashedRefreshToken,
      userId,
      deviceId,
      status: "ACTIVE",
      expiresAt,
      ipAddress,
    },
  });

  // Store session in Redis: session:{userId}:{deviceId}
  // Allows instant revocation by deleting this key
  const sessionKey = `session:${userId}:${deviceId}`;
  await redis.setEx(
    sessionKey,
    REFRESH_TOKEN_TTL_DAYS * 24 * 3600,
    JSON.stringify({ userId, role, jti, deviceId, createdAt: Date.now() }),
  );

  return { accessToken, refreshToken: rawRefreshToken };
}

// =============================================================================
// FIX 2 — Refresh token rotation with reuse detection
// =============================================================================
export async function refreshSession(rawRefreshToken, deviceId) {
  const hashedToken = hashToken(rawRefreshToken);

  // Look up token in DB
  const existingToken = await prisma.token.findUnique({
    where: { token: hashedToken },
    include: { user: { select: { id: true, role: true } } },
  });

  // Token not found at all
  if (!existingToken) {
    throw new ApiError(401, "Invalid refresh token");
  }

  // ── FIX 2: REUSE DETECTION ───────────────────────────────────────────────
  // Status USED means this token was already rotated once.
  // If someone is presenting it again, one of two things happened:
  //   a) Legitimate client replayed an old token (bug in client)
  //   b) Token was stolen and attacker used it first
  // In EITHER case: wipe all sessions for this user to be safe.
  if (existingToken.status === "USED") {
    logger.error(
      {
        userId: existingToken.userId,
        deviceId,
        tokenId: existingToken.id,
        type: "refresh_token_reuse",
      },
      "Refresh token reuse detected — wiping all sessions for user",
    );

    // Nuclear option: revoke everything for this user
    await wipeAllSessions(existingToken.userId);

    throw new ApiError(
      401,
      "Security alert: suspicious activity detected. Please log in again.",
    );
  }

  // Token explicitly revoked (logout, admin action, password change)
  if (existingToken.status === "REVOKED") {
    throw new ApiError(401, "Refresh token has been revoked");
  }

  // Token expired
  if (existingToken.expiresAt < new Date()) {
    throw new ApiError(401, "Refresh token expired");
  }

  // ── Token is valid — rotate ───────────────────────────────────────────────
  const { token: newAccessToken, jti } = signAccessToken({
    userId: existingToken.user.id,
    role: existingToken.user.role,
  });

  const newRawRefreshToken = generateRefreshToken();
  const newHashedRefreshToken = hashToken(newRawRefreshToken);

  const newExpiresAt = new Date();
  newExpiresAt.setDate(newExpiresAt.getDate() + REFRESH_TOKEN_TTL_DAYS);

  // Use a transaction: mark old token USED + create new token atomically
  await prisma.$transaction([
    // Mark old token as USED (not deleted — we need it for reuse detection)
    prisma.token.update({
      where: { id: existingToken.id },
      data: {
        status: "USED",
        replacedByToken: newHashedRefreshToken,
      },
    }),
    // Create new token
    prisma.token.create({
      data: {
        token: newHashedRefreshToken,
        userId: existingToken.userId,
        deviceId,
        status: "ACTIVE",
        expiresAt: newExpiresAt,
      },
    }),
  ]);

  // Update Redis session with new jti
  const sessionKey = `session:${existingToken.userId}:${deviceId}`;
  await redis.setEx(
    sessionKey,
    REFRESH_TOKEN_TTL_DAYS * 24 * 3600,
    JSON.stringify({
      userId: existingToken.userId,
      role: existingToken.user.role,
      jti,
      deviceId,
      rotatedAt: Date.now(),
    }),
  );

  return { accessToken: newAccessToken, refreshToken: newRawRefreshToken };
}

// =============================================================================
// FIX 2 — Wipe ALL sessions for a user
// Called when refresh token reuse is detected (possible token theft)
// =============================================================================
export async function wipeAllSessions(userId) {
  // 1. Revoke all refresh tokens in DB
  await prisma.token.updateMany({
    where: { userId, status: { in: ["ACTIVE", "USED"] } },
    data: { status: "REVOKED" },
  });

  // 2. Delete all Redis session keys for this user
  // Use SCAN to find all session:{userId}:* keys
  const pattern = `session:${userId}:*`;
  let cursor = 0;
  do {
    const result = await redis.scan(cursor, { MATCH: pattern, COUNT: 100 });
    cursor = result.cursor;
    if (result.keys.length > 0) {
      await redis.del(result.keys);
    }
  } while (cursor !== 0);

  logger.info(
    { userId, type: "all_sessions_wiped" },
    "All sessions wiped for user",
  );
}

// =============================================================================
// Revoke a single session (normal logout)
// =============================================================================
export async function revokeSession(
  rawRefreshToken,
  accessTokenJti,
  accessTokenTtlRemaining,
  deviceId,
) {
  const hashedToken = hashToken(rawRefreshToken);

  // Mark refresh token revoked in DB
  await prisma.token.updateMany({
    where: { token: hashedToken },
    data: { status: "REVOKED" },
  });

  // Blacklist the access token jti in Redis so it can't be reused within its TTL
  await blacklistToken(accessTokenJti, accessTokenTtlRemaining);

  // Delete Redis session
  // Note: deviceId comes from JWT payload — guaranteed to match the session key
  const sessionKey = `session:${(await prisma.token.findFirst({ where: { token: hashedToken } }))?.userId}:${deviceId}`;
  await redis.del(sessionKey);
}
