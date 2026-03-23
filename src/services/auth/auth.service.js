// =============================================================================
// src/services/auth/auth.service.js — RESQID
// =============================================================================

import crypto from "crypto";
import jwt from "jsonwebtoken";

import * as repo from "../../modules/auth/auth.repository.js";
import { prisma } from "../../config/prisma.js";

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

const OTP_TTL_SECONDS = 5 * 60; // 5 minutes
const OTP_MAX_ATTEMPTS = 5;
const NONCE_TTL = 10 * 60; // 10 minutes — registration nonce

const otpHashKey = (phone) => `otp:hash:${phone}`;
const otpAttemptsKey = (phone) => `otp:attempts:${phone}`;
const nonceKey = (nonce) => `reg:nonce:${nonce}`;

// =============================================================================
// SUPER ADMIN LOGIN
// SECURITY: constant-time password check + failed login audit
// =============================================================================

export const loginSuperAdmin = async ({
  email,
  password,
  ipAddress,
  deviceInfo,
  userAgent,
}) => {
  const admin = await repo.findSuperAdminByEmail(email);

  // SECURITY: always run verifyPassword even if admin not found — timing attack prevention
  const valid = await verifyPassword(
    password,
    admin?.password_hash ?? "$2b$12$invalidhashfortimingprotection",
  );

  if (!admin || !valid) {
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
// PARENT LOGIN: SEND OTP
// No DB lookup on send — avoids user-existence leak
// isNewUser is determined in verifyOtp after OTP is confirmed valid
// =============================================================================

export const sendOtp = async ({ phone }) => {
  const otp = generateOtp();
  const hashed = hashOtp(otp);

  await Promise.all([
    redis.setex(otpHashKey(phone), OTP_TTL_SECONDS, hashed),
    redis.del(otpAttemptsKey(phone)),
  ]);

  if (process.env.NODE_ENV !== "production") {
    logger.info({ phone, devCode: otp }, "[DEV] OTP"); // devCode avoids REDACT_PATHS
  }

  return { message: "OTP sent successfully" };
};

// =============================================================================
// PARENT LOGIN: VERIFY OTP
// SECURITY: constant-time comparison — prevents timing attacks on OTP
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

  const storedBuf = Buffer.from(storedHash, "hex");
  const inputBuf = Buffer.from(inputHash, "hex");

  const valid =
    storedBuf.length === inputBuf.length &&
    crypto.timingSafeEqual(storedBuf, inputBuf);

  if (!valid) {
    await redis.incr(otpAttemptsKey(phone));
    throw ApiError.unauthorized("Invalid OTP");
  }

  await Promise.all([
    redis.del(otpHashKey(phone)),
    redis.del(otpAttemptsKey(phone)),
  ]);

  const phoneIndex = hashForLookup(phone);
  let parent = await repo.findParentByPhoneIndex(phoneIndex);

  // 🚨 FIX: do NOT create parent in login flow
  if (!parent) {
    throw ApiError.badRequest("Account not found. Please register first.");
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
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: expiresAt,
    is_new_user: false,
    parent_id: parent.id,
  };
};

// =============================================================================
// PARENT REGISTRATION: STEP 1 — INIT
//
// 1. Validate card_number exists, has a student, is not already claimed
// 2. Generate one-time nonce (binds card + phone, stored in Redis 10min)
// 3. Send OTP to phone
// 4. Return nonce + masked phone for frontend display
// =============================================================================

export const registerInit = async ({ card_number, phone }) => {
  const card = await repo.findCardForRegistration(card_number);

  // Card must exist and belong to an active school
  if (!card) {
    throw ApiError.notFound(
      "Card not found. Check the number printed on your physical card.",
    );
  }

  // Card already claimed — student exists and has a parent linked
  // BLANK cards have student_id = null until first registration — that is normal
  if (card.student_id && card.student?.parents?.length > 0) {
    throw ApiError.conflict(
      "This card is already registered. Sign in instead.",
    );
  }

  // Edge case: student exists (PRE_DETAILS order) but is inactive
  if (card.student_id && !card.student?.is_active) {
    throw ApiError.badRequest(
      "This card is linked to an inactive student. Contact your school.",
    );
  }

  // Generate nonce — 64 hex chars, single-use, 10min TTL
  // Store card_id (not student_id) — student doesn't exist yet for BLANK cards
  const nonce = crypto.randomBytes(32).toString("hex");
  const nonceData = JSON.stringify({
    card_id: card.id,
    card_number,
    school_id: card.school_id,
    // For PRE_DETAILS cards: student already exists, carry their id
    // For BLANK cards: null — student will be created in registerVerify
    student_id: card.student_id ?? null,
    phone, // must match in step 2
  });

  await redis.setex(nonceKey(nonce), NONCE_TTL, nonceData);

  // Send OTP
  const otp = generateOtp();
  const hashed = hashOtp(otp);

  await Promise.all([
    redis.setex(otpHashKey(phone), OTP_TTL_SECONDS, hashed),
    redis.del(otpAttemptsKey(phone)),
  ]);

  if (process.env.NODE_ENV !== "production") {
    logger.info({ phone, devCode: otp }, "[DEV] Registration OTP");
  }

  const masked_phone = phone.replace(/(\+\d{2})(\d{5})(\d{5})/, "$1 *****$3");

  return {
    nonce,
    masked_phone,
    // For PRE_DETAILS cards: show the student name as a welcome hint
    // For BLANK cards: null — parent hasn't set up profile yet
    student_first_name: card.student?.first_name ?? null,
  };
};

// =============================================================================
// PARENT REGISTRATION: STEP 2 — VERIFY
//
// 1. Verify OTP (constant-time, attempt-limited)
// 2. Validate nonce (single-use, phone must match step 1)
// 3. Atomic transaction: create/find parent + link to student
// 4. Issue session + token pair
// =============================================================================

export const registerVerify = async ({
  nonce,
  otp,
  phone,
  ipAddress,
  deviceInfo,
}) => {
  // [1] OTP validation (unchanged)
  const attempts = parseInt(
    (await redis.get(otpAttemptsKey(phone))) ?? "0",
    10,
  );

  if (attempts >= OTP_MAX_ATTEMPTS) {
    throw ApiError.tooManyRequests("Too many OTP attempts. Try again later.");
  }

  const storedHash = await redis.get(otpHashKey(phone));
  if (!storedHash)
    throw ApiError.badRequest("OTP expired. Request a new code.");

  const inputHash = hashOtp(otp);
  const storedBuf = Buffer.from(storedHash, "hex");
  const inputBuf = Buffer.from(inputHash, "hex");

  const valid =
    storedBuf.length === inputBuf.length &&
    crypto.timingSafeEqual(storedBuf, inputBuf);

  if (!valid) {
    await redis.incr(otpAttemptsKey(phone));
    throw ApiError.unauthorized("Invalid OTP");
  }

  // [2] Nonce validation (unchanged)
  const nonceRaw = await redis.get(nonceKey(nonce));
  if (!nonceRaw) {
    throw ApiError.badRequest(
      "Registration session expired. Please start again.",
    );
  }

  const nonceData = JSON.parse(nonceRaw);

  if (nonceData.phone !== phone) {
    throw ApiError.badRequest(
      "Phone number mismatch. Please start registration again.",
    );
  }

  const phoneIndex = hashForLookup(phone);

  const { parent, studentId, isNewUser } = await prisma.$transaction(
    async (tx) => {
      // ── Parent ──────────────────────────────────────────────
      let existing = await tx.parentUser.findUnique({
        where: { phone_index: phoneIndex },
        select: { id: true, status: true },
      });

      let isNew = false;
      if (!existing) {
        existing = await tx.parentUser.create({
          data: {
            phone: encryptField(phone),
            phone_index: phoneIndex,
            is_phone_verified: true,
            status: "ACTIVE",
          },
          select: { id: true, status: true },
        });
        isNew = true;
      }

      // ── Student handling ────────────────────────────────────
      let resolvedStudentId = nonceData.student_id;

      if (!resolvedStudentId) {
        // BLANK card → create student
        const stubStudent = await tx.student.create({
          data: {
            school_id: nonceData.school_id,
            first_name: null,
            last_name: null,
            setup_stage: "PENDING",
            is_active: true,
          },
          select: { id: true },
        });

        resolvedStudentId = stubStudent.id;

        await tx.emergencyProfile.create({
          data: {
            student_id: resolvedStudentId,
            visibility: "HIDDEN",
            is_visible: false,
          },
        });

        await tx.card.update({
          where: { id: nonceData.card_id },
          data: { student_id: resolvedStudentId },
        });
      }

      // 🔥 FIX: ALWAYS LINK TOKEN → STUDENT (for BOTH flows)
      const cardWithToken = await tx.card.findUnique({
        where: { id: nonceData.card_id },
        select: { token_id: true },
      });

      if (cardWithToken?.token_id) {
        await tx.token.update({
          where: { id: cardWithToken.token_id },
          data: {
            student_id: resolvedStudentId,
            status: "ACTIVE",
          },
        });
      }

      // ── ParentStudent link ─────────────────────────────────
      await tx.parentStudent.upsert({
        where: {
          parent_id_student_id: {
            parent_id: existing.id,
            student_id: resolvedStudentId,
          },
        },
        update: {},
        create: {
          parent_id: existing.id,
          student_id: resolvedStudentId,
          relationship: "Parent",
          is_primary: true,
        },
      });

      await tx.parentNotificationPref.upsert({
        where: { parent_id: existing.id },
        update: {},
        create: { parent_id: existing.id },
      });

      return {
        parent: existing,
        studentId: resolvedStudentId,
        isNewUser: isNew,
      };
    },
  );

  // cleanup (unchanged)
  await Promise.all([
    redis.del(nonceKey(nonce)),
    redis.del(otpHashKey(phone)),
    redis.del(otpAttemptsKey(phone)),
  ]);

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
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: expiresAt,
    is_new_user: isNewUser,
    parent_id: parent.id,
    student_id: studentId,
  };
};

// =============================================================================
// REFRESH TOKENS
// SECURITY: reuse detection — rotated token replayed = wipe all sessions
// =============================================================================

export const refreshTokens = async ({
  refreshToken,
  ipAddress,
  deviceInfo,
}) => {
  const hash = hashToken(refreshToken);

  // Check if this refresh token was already rotated (reuse = possible theft)
  const isBlacklisted = await redis.get(`blacklist:${hash}`);
  if (isBlacklisted) {
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

  await repo.updateSessionRefreshHash(session.id, refreshHash);

  // Blacklist old refresh token with metadata for reuse detection
  const oldHashTtl = Math.ceil(
    (new Date(session.expires_at) - Date.now()) / 1000,
  );
  if (oldHashTtl > 0) {
    await redis
      .setex(`blacklist:${hash}`, oldHashTtl, JSON.stringify({ userId, role }))
      .catch(() => {});
    repo.addRefreshToBlacklist(hash, session.expires_at).catch(() => {});
  }

  // Invalidate session cache — old cached session has stale refresh hash
  await invalidateSessionCache(session.id);

  return {
    access_token: accessToken,
    refresh_token: newRefresh,
    expires_at: expiresAt,
  };
};

// =============================================================================
// LOGOUT
// Kills Redis caches immediately — no waiting for TTL expiry
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

  // 1. Blacklist access token + kill its Redis "clean" cache
  const accessHash = hashToken(token);
  ops.push(repo.addToBlacklist(accessHash, new Date(exp * 1000)));
  ops.push(invalidateBlacklistCache(accessHash));

  // 2. Revoke session in DB
  if (sessionId) ops.push(repo.revokeSession(sessionId, "MANUAL_LOGOUT"));

  // 3. Blacklist refresh token — can't be replayed post-logout
  if (refreshToken) {
    const refreshHash = hashToken(refreshToken);
    const refreshExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    ops.push(repo.addRefreshToBlacklist(refreshHash, refreshExpiry));

    ops.push(
      repo.findSessionByRefreshHash(refreshHash).then((s) => {
        if (s && s.id !== sessionId)
          return repo.revokeSession(s.id, "MANUAL_LOGOUT");
      }),
    );
  }

  await Promise.all(ops);

  // 4. Kill Redis caches immediately
  await Promise.all([
    sessionId ? invalidateSessionCache(sessionId) : Promise.resolve(),
    userId && role ? invalidateUserCache(role, userId) : Promise.resolve(),
  ]);
};

// =============================================================================
// INTERNAL: Wipe all sessions (reuse detection nuclear option)
// =============================================================================

async function wipeAllSessions(userId, role) {
  const sessionIds = await repo.findAllActiveSessionIds(userId, role);
  await repo.revokeAllUserSessions(userId, role, "SUSPICIOUS_ACTIVITY");

  await Promise.all([
    ...sessionIds.map((id) => invalidateSessionCache(id)),
    invalidateUserCache(role, userId),
  ]);

  logger.warn(
    { userId, role, sessionCount: sessionIds.length },
    "All sessions wiped — reuse detected",
  );
}
