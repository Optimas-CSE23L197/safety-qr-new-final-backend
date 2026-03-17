// =============================================================================
// auth.service.js — RESQID
//
// FIX [#14]: Session creation was happening BEFORE token issuance across all
// three login flows (loginSuperAdmin, loginSchoolUser, verifyOtp). Since
// Session.refresh_token_hash is non-nullable in the schema, Prisma rejected
// the create() call with:
//   "Argument `refresh_token_hash` is missing."
//
// FIX [#15]: sessionId was null in JWT payload across all login flows because
// the session DB record didn't exist yet when tokens were issued. Fixed by
// pre-generating the session UUID with crypto.randomUUID() and passing it
// into both issueTokenPair (so the JWT carries the real sessionId) and
// createSession (so Prisma uses that same ID via id: sessionId in data).
// This keeps tokens first + single DB write, while having a valid sessionId.
//
// updateSessionRefreshHash is still needed for the REFRESH flow (rotating
// the hash on every token refresh) — that call is intentional and kept.
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

// =============================================================================
// CONSTANTS
// =============================================================================

const OTP_TTL_SECONDS = 5 * 60;
const OTP_MAX_ATTEMPTS = 5;

const otpHashKey = (phone) => `otp:hash:${phone}`;
const otpAttemptsKey = (phone) => `otp:attempts:${phone}`;

// =============================================================================
// SUPER ADMIN LOGIN
// =============================================================================

export const loginSuperAdmin = async ({
  email,
  password,
  ipAddress,
  deviceInfo,
}) => {
  const admin = await repo.findSuperAdminByEmail(email);

  const valid = await verifyPassword(password, admin?.password_hash);

  if (!admin || !valid) {
    throw ApiError.unauthorized("Invalid credentials");
  }

  if (!admin.is_active) {
    throw ApiError.forbidden("Account disabled");
  }

  // Pre-generate sessionId so JWT payload carries a real session reference
  const sessionId = crypto.randomUUID();

  const { accessToken, refreshToken, refreshHash, expiresAt } = issueTokenPair({
    userId: admin.id,
    role: "SUPER_ADMIN",
    sessionId, // ✅ real UUID — not null
  });

  await repo.createSession({
    id: sessionId, // ✅ Prisma uses this exact UUID — JWT and DB are in sync
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
    ua: deviceInfo,
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
// =============================================================================

export const loginSchoolUser = async ({
  email,
  password,
  ipAddress,
  deviceInfo,
}) => {
  const user = await repo.findSchoolUserByEmail(email);

  const valid = await verifyPassword(password, user?.password_hash);

  if (!user || !valid) {
    throw ApiError.unauthorized("Invalid credentials");
  }

  if (!user.is_active) {
    throw ApiError.forbidden("Account disabled");
  }

  const sessionId = crypto.randomUUID();

  const { accessToken, refreshToken, refreshHash, expiresAt } = issueTokenPair({
    userId: user.id,
    role: "SCHOOL_USER",
    schoolId: user.school_id,
    sessionId, // ✅
  });

  await repo.createSession({
    id: sessionId, // ✅
    schoolUserId: user.id,
    ipAddress,
    deviceInfo,
    expiresAt,
    refreshHash,
  });

  repo.updateSchoolUserLastLogin(user.id).catch(() => {});

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
// =============================================================================

export const sendOtp = async ({ phone }) => {
  const otp = generateOtp();
  const hashed = hashOtp(otp);

  await redis.setex(otpHashKey(phone), OTP_TTL_SECONDS, hashed);
  await redis.del(otpAttemptsKey(phone));

  if (process.env.NODE_ENV !== "production") {
    logger.info({ phone, otp }, "[DEV] OTP");
  }

  const phoneIndex = hashForLookup(phone);
  const existingParent = await repo.findParentByPhoneIndex(phoneIndex);

  return {
    message: "OTP sent successfully",
    isNewUser: !existingParent,
  };
};

// =============================================================================
// VERIFY OTP
// =============================================================================

export const verifyOtp = async ({ phone, otp, ipAddress, deviceInfo }) => {
  const attempts = parseInt(
    (await redis.get(otpAttemptsKey(phone))) ?? "0",
    10,
  );

  if (attempts >= OTP_MAX_ATTEMPTS) {
    throw ApiError.tooManyRequests("Too many OTP attempts");
  }

  const storedHash = await redis.get(otpHashKey(phone));

  if (!storedHash) {
    throw ApiError.badRequest("OTP expired");
  }

  const valid = storedHash === hashOtp(otp);

  if (!valid) {
    await redis.incr(otpAttemptsKey(phone));
    throw ApiError.unauthorized("Invalid OTP");
  }

  await redis.del(otpHashKey(phone));
  await redis.del(otpAttemptsKey(phone));

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
    sessionId, // ✅
  });

  await repo.createSession({
    id: sessionId, // ✅
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
    parent: {
      id: parent.id,
    },
  };
};

// =============================================================================
// REFRESH TOKEN
// =============================================================================

export const refreshTokens = async ({
  refreshToken,
  ipAddress,
  deviceInfo,
}) => {
  const hash = hashToken(refreshToken);
  const session = await repo.findSessionByRefreshHash(hash);

  if (!session || !session.is_active) {
    throw ApiError.unauthorized("Session invalid");
  }

  if (session.expires_at < new Date()) {
    throw ApiError.sessionExpired();
  }

  let role;
  let userId;
  let schoolId;

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

  // Intentional — rotating hash on every token refresh
  await repo.updateSessionRefreshHash(session.id, refreshHash);

  return {
    access_token: accessToken,
    refresh_token: newRefresh,
    expiresAt: jwt.decode(accessToken)?.exp,
  };
};

// =============================================================================
// LOGOUT
// =============================================================================

export const logoutUser = async ({ token, exp, refreshToken, sessionId }) => {
  await repo.addToBlacklist(hashToken(token), new Date(exp * 1000));

  if (sessionId) {
    await repo.revokeSession(sessionId);
  }

  if (refreshToken) {
    const session = await repo.findSessionByRefreshHash(
      hashToken(refreshToken),
    );
    if (session) {
      await repo.revokeSession(session.id);
    }
  }
};
