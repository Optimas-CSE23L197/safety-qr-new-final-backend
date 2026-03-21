// =============================================================================
// auth.service.js — RESQID
// =============================================================================

import crypto from "crypto";
import jwt from "jsonwebtoken";

import * as repo from "../../modules/auth/auth.repository.js";

import { ApiError } from "../../utils/response/ApiError.js";
import { verifyPassword, hashToken } from "../../utils/security/hashUtil.js";
import {
  encryptField,
  hashForLookup,
} from "../../utils/security/encryption.js";
import { issueTokenPair } from "../../utils/security/jwt.js";
import { generateOtp, hashOtp } from "../../services/otp/otp.service.js";

import { redis } from "../../config/redis.js";
import { logger } from "../../config/logger.js";
import { writeAuditLog, AuditAction } from "../../utils/helpers/auditLogger.js";

import {
  invalidateSessionCache,
  invalidateUserCache,
  invalidateBlacklistCache,
} from "../../middleware/auth.middleware.js";

// =============================================================================
// CONSTANTS
// =============================================================================

const OTP_TTL_SECONDS = 5 * 60;
const OTP_MAX_ATTEMPTS = 5;

const otpHashKey = (phone) => `otp:hash:${phone}`;
const otpAttemptsKey = (phone) => `otp:attempts:${phone}`;

// Refresh token blacklist key in Redis — mirrors access token blacklist
const refreshBlacklistKey = (hash) => `blacklist:${hash}`;

// =============================================================================
// SUPER ADMIN LOGIN
// SECURITY: constant-time password check (verifyPassword uses bcrypt which
// is already constant-time). Failed logins written to AuditLog.
// =============================================================================

export const loginSuperAdmin = async ({
  email,
  password,
  ipAddress,
  deviceInfo,
  userAgent,
}) => {
  const admin = await repo.findSuperAdminByEmail(email);

  // SECURITY: always run verifyPassword even if admin not found —
  // prevents timing attack that reveals whether email exists
  const valid = await verifyPassword(
    password,
    admin?.password_hash ?? "$2b$12$invalidhashfortimingprotection",
  );

  if (!admin || !valid) {
    // SECURITY: log failed attempt — invisible brute force before this fix
    repo
      .logFailedLogin({
        actorType: "SUPER_ADMIN",
        identifier: email,
        ipAddress,
        userAgent,
        reason: !admin ? "EMAIL_NOT_FOUND" : "WRONG_PASSWORD",
      })
      .catch(() => {});

    throw ApiError.unauthorized("Invalid credentials");
  }

  if (!admin.is_active) throw ApiError.forbidden("Account disabled");

  const sessionId = crypto.randomUUID();

  const { accessToken, refreshToken, refreshHash, expiresAt } = issueTokenPair({
    userId: admin.id,
    role: "SUPER_ADMIN",
    sessionId,
  });

  await repo.createSession({
    id: sessionId,
    superAdminId: admin.id,
    ipAddress,
    deviceInfo,
    expiresAt,
    refreshHash,
  });

  repo.updateSuperAdminLastLogin(admin.id).catch(() => {});

  writeAuditLog({
    actorId: admin.id,
    actorType: "SUPER_ADMIN",
    action: AuditAction.LOGIN,
    entity: "SuperAdmin",
    entityId: admin.id,
    ip: ipAddress,
    ua: userAgent,
  });

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    user: {
      id: admin.id,
      name: admin.name,
      email: admin.email,
      role: "SUPER_ADMIN",
    },
  };
};

// =============================================================================
// SCHOOL USER LOGIN
// SECURITY: same timing protection + failed login audit as super admin
// =============================================================================

export const loginSchoolUser = async ({
  email,
  password,
  ipAddress,
  deviceInfo,
  userAgent,
}) => {
  const user = await repo.findSchoolUserByEmail(email);
  const valid = await verifyPassword(
    password,
    user?.password_hash ?? "$2b$12$invalidhashfortimingprotection",
  );

  if (!user || !valid) {
    repo
      .logFailedLogin({
        actorType: "SCHOOL_USER",
        identifier: email,
        ipAddress,
        userAgent,
        reason: !user ? "EMAIL_NOT_FOUND" : "WRONG_PASSWORD",
      })
      .catch(() => {});

    throw ApiError.unauthorized("Invalid credentials");
  }

  if (!user.is_active) throw ApiError.forbidden("Account disabled");

  const sessionId = crypto.randomUUID();

  const { accessToken, refreshToken, refreshHash, expiresAt } = issueTokenPair({
    userId: user.id,
    role: "SCHOOL_USER",
    schoolId: user.school_id,
    sessionId,
  });

  await repo.createSession({
    id: sessionId,
    schoolUserId: user.id,
    ipAddress,
    deviceInfo,
    expiresAt,
    refreshHash,
  });

  repo.updateSchoolUserLastLogin(user.id).catch(() => {});

  writeAuditLog({
    actorId: user.id,
    actorType: "SCHOOL_USER",
    action: AuditAction.LOGIN,
    entity: "SchoolUser",
    entityId: user.id,
    ip: ipAddress,
    ua: userAgent,
  });

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      school_id: user.school_id,
    },
  };
};

// =============================================================================
// SEND OTP
// SECURITY: DB lookup removed — no user existence leak on send.
// isNewUser check moved to verifyOtp (after OTP confirmed valid).
// =============================================================================

export const sendOtp = async ({ phone }) => {
  const otp = generateOtp();
  const hashed = hashOtp(otp);

  await Promise.all([
    redis.setex(otpHashKey(phone), OTP_TTL_SECONDS, hashed),
    redis.del(otpAttemptsKey(phone)),
  ]);

  if (process.env.NODE_ENV !== "production") {
    logger.info({ phone, otp }, "[DEV] OTP");
  }

  // Always return same message — never reveal if phone is registered or not
  return { message: "OTP sent successfully" };
};

// =============================================================================
// VERIFY OTP
// SECURITY: constant-time OTP comparison using crypto.timingSafeEqual —
// prevents timing attacks that could allow guessing OTP digits by measuring
// response time differences.
// =============================================================================

export const verifyOtp = async ({ phone, otp, ipAddress, deviceInfo }) => {
  const attempts = parseInt(
    (await redis.get(otpAttemptsKey(phone))) ?? "0",
    10,
  );

  if (attempts >= OTP_MAX_ATTEMPTS) {
    throw ApiError.tooManyRequests("Too many OTP attempts. Try again later.");
  }

  const storedHash = await redis.get(otpHashKey(phone));
  if (!storedHash) throw ApiError.badRequest("OTP expired or not requested");

  const inputHash = hashOtp(otp);

  // SECURITY: constant-time comparison — prevents timing attack on OTP
  // Without this, an attacker can measure μs differences to guess digits
  const storedBuf = Buffer.from(storedHash, "hex");
  const inputBuf = Buffer.from(inputHash, "hex");

  const valid =
    storedBuf.length === inputBuf.length &&
    crypto.timingSafeEqual(storedBuf, inputBuf);

  if (!valid) {
    await redis.incr(otpAttemptsKey(phone));
    throw ApiError.unauthorized("Invalid OTP");
  }

  // OTP valid — clean up Redis in parallel
  await Promise.all([
    redis.del(otpHashKey(phone)),
    redis.del(otpAttemptsKey(phone)),
  ]);

  // DB lookup happens HERE — after OTP confirmed valid, not on send
  const phoneIndex = hashForLookup(phone);
  let parent = await repo.findParentByPhoneIndex(phoneIndex);
  const isNewUser = !parent;

  if (!parent) {
    parent = await repo.createParentUser({
      encryptedPhone: encryptField(phone),
      phoneIndex,
    });
  }

  const sessionId = crypto.randomUUID();

  const { accessToken, refreshToken, refreshHash, expiresAt } = issueTokenPair({
    userId: parent.id,
    role: "PARENT_USER",
    sessionId,
  });

  await repo.createSession({
    id: sessionId,
    parentUserId: parent.id,
    ipAddress,
    deviceInfo,
    expiresAt,
    refreshHash,
  });

  repo.updateParentLastLogin(parent.id).catch(() => {});

  return {
    accessToken,
    refreshToken,
    expiresAt: jwt.decode(accessToken)?.exp,
    isNewUser,
    parent: { id: parent.id },
  };
};

// =============================================================================
// REFRESH TOKENS
// SECURITY: refresh token reuse detection — if a refresh token that was
// already rotated is presented again, it means either:
//   a) Legitimate client has a bug and replayed an old token
//   b) Token was stolen — attacker used it first, now legitimate client
//      is presenting it and getting 401
// In EITHER case: wipe ALL sessions for this user across all devices.
// User is forced to re-login. If it was theft, attacker loses access too.
//
// How it works with current schema:
//   Session has refresh_token_hash (current valid hash).
//   On rotate: new hash replaces old hash in DB.
//   Old hash is blacklisted in Redis + BlacklistToken.
//   If old hash presented again → found in blacklist → reuse detected → wipe.
// =============================================================================

export const refreshTokens = async ({
  refreshToken,
  ipAddress,
  deviceInfo,
}) => {
  const hash = hashToken(refreshToken);

  // SECURITY: check if this refresh token was already rotated (reuse detection)
  // If it's in the blacklist, it was used before — potential theft
  const isBlacklisted = await redis.get(`blacklist:${hash}`);
  if (isBlacklisted) {
    // Extract userId from the blacklisted token metadata to wipe sessions
    const meta = JSON.parse(isBlacklisted);
    if (meta?.userId && meta?.role) {
      logger.error(
        {
          userId: meta.userId,
          role: meta.role,
          ip: ipAddress,
          type: "refresh_token_reuse",
        },
        "Refresh token reuse detected — wiping all sessions",
      );
      await wipeAllSessions(meta.userId, meta.role);
    }
    throw ApiError.unauthorized("Security alert: please log in again");
  }

  const session = await repo.findSessionByRefreshHash(hash);

  if (!session || !session.is_active)
    throw ApiError.unauthorized("Session invalid");
  if (session.expires_at < new Date()) throw ApiError.sessionExpired();

  // Resolve user identity from session
  let role, userId, schoolId;

  if (session.admin_user_id) {
    role = "SUPER_ADMIN";
    userId = session.admin_user_id;
  } else if (session.school_user_id) {
    role = "SCHOOL_USER";
    userId = session.school_user_id;
    const user = await repo.findSchoolUserById(userId);
    schoolId = user?.school_id;
  } else {
    role = "PARENT_USER";
    userId = session.parent_user_id;
  }

  const {
    accessToken,
    refreshToken: newRefresh,
    refreshHash,
  } = issueTokenPair({
    userId,
    role,
    sessionId: session.id,
    schoolId,
  });

  // Rotate: update DB with new hash
  await repo.updateSessionRefreshHash(session.id, refreshHash);

  // SECURITY: blacklist OLD refresh token hash with userId metadata
  // so reuse detection can identify WHO to wipe if it's replayed
  const oldHashTtl = Math.ceil(
    (new Date(session.expires_at) - Date.now()) / 1000,
  );
  if (oldHashTtl > 0) {
    await redis
      .setex(`blacklist:${hash}`, oldHashTtl, JSON.stringify({ userId, role }))
      .catch(() => {});
    // Also persist to DB for Redis-eviction safety
    repo.addRefreshToBlacklist(hash, session.expires_at).catch(() => {});
  }

  // Invalidate session cache — old cached session has stale refresh hash
  await invalidateSessionCache(session.id);

  return {
    access_token: accessToken,
    refresh_token: newRefresh,
    expiresAt: jwt.decode(accessToken)?.exp,
  };
};

// =============================================================================
// LOGOUT
// SECURITY: kills Redis caches immediately — previously logged-out users
// could authenticate for up to 60s (session TTL) + 5min (user cache TTL).
// Also blacklists refresh token so it can't be replayed post-logout.
// =============================================================================

export const logoutUser = async ({
  token,
  exp,
  refreshToken,
  sessionId,
  userId,
  role,
}) => {
  const ops = [];

  // 1. Blacklist access token + invalidate its Redis "clean" cache immediately
  const accessHash = hashToken(token);
  ops.push(repo.addToBlacklist(accessHash, new Date(exp * 1000)));
  ops.push(invalidateBlacklistCache(accessHash));

  // 2. Revoke session in DB
  if (sessionId) {
    ops.push(repo.revokeSession(sessionId, "MANUAL_LOGOUT"));
  }

  // 3. SECURITY: blacklist refresh token so it can't be replayed after logout
  if (refreshToken) {
    const refreshHash = hashToken(refreshToken);
    const refreshExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days max
    ops.push(repo.addRefreshToBlacklist(refreshHash, refreshExpiry));

    // Also kill session found via refresh hash (edge case: different sessionId)
    ops.push(
      repo.findSessionByRefreshHash(refreshHash).then((s) => {
        if (s && s.id !== sessionId)
          return repo.revokeSession(s.id, "MANUAL_LOGOUT");
      }),
    );
  }

  await Promise.all(ops);

  // 4. Kill Redis caches immediately — don't wait for TTL expiry
  await Promise.all([
    sessionId ? invalidateSessionCache(sessionId) : Promise.resolve(),
    userId && role ? invalidateUserCache(role, userId) : Promise.resolve(),
  ]);
};

// =============================================================================
// INTERNAL: Wipe all sessions (reuse detection nuclear option)
// =============================================================================

async function wipeAllSessions(userId, role) {
  // Get all active session IDs before revoking (for Redis cache invalidation)
  const sessionIds = await repo.findAllActiveSessionIds(userId, role);

  // Revoke all in DB
  await repo.revokeAllUserSessions(userId, role, "SUSPICIOUS_ACTIVITY");

  // Kill all Redis session caches in parallel
  await Promise.all([
    ...sessionIds.map((id) => invalidateSessionCache(id)),
    invalidateUserCache(role, userId),
  ]);

  logger.warn(
    { userId, role, sessionCount: sessionIds.length },
    "All sessions wiped — reuse detected",
  );
}
