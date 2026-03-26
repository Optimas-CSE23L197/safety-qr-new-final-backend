// =============================================================================
// src/services/auth/auth.service.js — RESQID
// BUSINESS LOGIC ONLY — calls repository for DB operations
// UPDATED WITH BEHAVIORAL SECURITY INTEGRATION & OTP LOGGING
// =============================================================================

import crypto from "crypto";
import bcrypt from "bcrypt";
import { redis } from "../../config/redis.js";
import { prisma } from "../../config/prisma.js";
import { ApiError } from "../../utils/response/ApiError.js";
import { verifyPassword, hashToken } from "../../utils/security/hashUtil.js";
import {
  encryptField,
  hashForLookup,
} from "../../utils/security/encryption.js";
import { issueTokenPair } from "../../utils/security/jwt.js";
import { generateOtp, hashOtp } from "../otp/otp.service.js";
import { generateDeviceFingerprint } from "../../utils/security/deviceFingerprint.js";
import { logger } from "../../config/logger.js";

// Behavioral security imports
import {
  recordFailedAuth,
  recordSuccessfulAuth,
} from "../../middleware/behavioralSecurity.middleware.js";

import * as repo from "../../modules/auth/auth.repository.js";

// =============================================================================
// CONSTANTS
// =============================================================================

const OTP_TTL_SECONDS = 5 * 60;
const OTP_MAX_ATTEMPTS = 5;
const NONCE_TTL = 10 * 60;

// =============================================================================
// SUPER ADMIN LOGIN
// =============================================================================

export const loginSuperAdmin = async ({
  email,
  password,
  ipAddress,
  deviceInfo,
  userAgent,
}) => {
  console.log(`\n🔐 [SUPER ADMIN LOGIN] Email: ${email} from ${ipAddress}`);

  const admin = await repo.findSuperAdminByEmail(email);

  const valid = await verifyPassword(
    password,
    admin?.password_hash ?? "$2b$12$invalidhashfortimingprotection",
  );

  if (!admin || !valid) {
    console.log(
      `❌ [SUPER ADMIN LOGIN FAILED] Email: ${email} - ${!admin ? "User not found" : "Wrong password"}`,
    );
    await recordFailedAuth(
      ipAddress,
      email,
      !admin ? "EMAIL_NOT_FOUND" : "WRONG_PASSWORD",
    );

    await repo.logFailedLogin({
      actorType: "SUPER_ADMIN",
      identifier: email,
      ipAddress,
      userAgent,
      reason: !admin ? "EMAIL_NOT_FOUND" : "WRONG_PASSWORD",
    });
    throw ApiError.unauthorized("Invalid credentials");
  }

  if (!admin.is_active) {
    console.log(`❌ [SUPER ADMIN LOGIN FAILED] Account disabled: ${email}`);
    throw ApiError.forbidden("Account disabled");
  }

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

  await repo.updateSuperAdminLastLogin(admin.id).catch(() => {});
  await recordSuccessfulAuth(ipAddress, admin.id, "SUPER_ADMIN");

  await repo
    .createAuditLog({
      actorId: admin.id,
      actorType: "SUPER_ADMIN",
      action: "LOGIN",
      entity: "SuperAdmin",
      entityId: admin.id,
      ip: ipAddress,
      ua: userAgent,
    })
    .catch(() => {});

  console.log(`✅ [SUPER ADMIN LOGIN SUCCESS] ${admin.email}`);

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
// SCHOOL ADMIN LOGIN
// =============================================================================

export const loginSchoolUser = async ({
  email,
  password,
  ipAddress,
  deviceInfo,
  userAgent,
}) => {
  console.log(`\n🏫 [SCHOOL ADMIN LOGIN] Email: ${email} from ${ipAddress}`);

  const user = await repo.findSchoolUserByEmail(email);

  const valid = await verifyPassword(
    password,
    user?.password_hash ?? "$2b$12$invalidhashfortimingprotection",
  );

  if (!user || !valid) {
    console.log(`❌ [SCHOOL ADMIN LOGIN FAILED] Email: ${email}`);
    await recordFailedAuth(
      ipAddress,
      email,
      !user ? "EMAIL_NOT_FOUND" : "WRONG_PASSWORD",
    );

    await repo.logFailedLogin({
      actorType: "ADMIN",
      identifier: email,
      ipAddress,
      userAgent,
      reason: !user ? "EMAIL_NOT_FOUND" : "WRONG_PASSWORD",
    });
    throw ApiError.unauthorized("Invalid credentials");
  }

  if (!user.is_active) {
    console.log(`❌ [SCHOOL ADMIN LOGIN FAILED] Account disabled: ${email}`);
    throw ApiError.forbidden("Account disabled");
  }

  const sessionId = crypto.randomUUID();
  const { accessToken, refreshToken, refreshHash, expiresAt } = issueTokenPair({
    userId: user.id,
    role: "ADMIN",
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

  await repo.updateSchoolUserLastLogin(user.id).catch(() => {});
  await recordSuccessfulAuth(ipAddress, user.id, "ADMIN");

  await repo
    .createAuditLog({
      actorId: user.id,
      actorType: "ADMIN",
      action: "LOGIN",
      entity: "SchoolUser",
      entityId: user.id,
      ip: ipAddress,
      ua: userAgent,
    })
    .catch(() => {});

  console.log(
    `✅ [SCHOOL ADMIN LOGIN SUCCESS] ${user.email} (School: ${user.school_id})`,
  );

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
// =============================================================================

export const sendOtp = async ({ phone, ipAddress, deviceId }) => {
  console.log(`\n📱 [OTP REQUEST] Phone: ${phone} from ${ipAddress}`);

  const phoneKey = `otp:phone:${phone}`;
  const phoneAttempts = await redis.incr(phoneKey);
  if (phoneAttempts === 1) await redis.expire(phoneKey, 3600);
  console.log(`📊 Phone attempts: ${phoneAttempts}/5`);

  if (phoneAttempts > 5) {
    console.log(
      `❌ [OTP BLOCKED] Phone ${phone} exceeded limit (${phoneAttempts})`,
    );
    await recordFailedAuth(ipAddress, phone, "OTP_PHONE_LIMIT_EXCEEDED");
    throw ApiError.tooManyRequests("Too many OTP requests. Try after 1 hour.");
  }

  const ipKey = `otp:ip:${ipAddress}`;
  const ipAttempts = await redis.incr(ipKey);
  if (ipAttempts === 1) await redis.expire(ipKey, 3600);
  console.log(`🌐 IP attempts: ${ipAttempts}/20`);

  if (ipAttempts > 20) {
    console.log(
      `❌ [OTP BLOCKED] IP ${ipAddress} exceeded limit (${ipAttempts})`,
    );
    await recordFailedAuth(ipAddress, phone, "OTP_IP_LIMIT_EXCEEDED");
    throw ApiError.tooManyRequests("Too many OTP requests from this IP.");
  }

  const otp = generateOtp();
  const hashed = hashOtp(otp);

  console.log(`🔐 [OTP GENERATED] Phone: ${phone}, OTP: ${otp}`);
  console.log(`⏱️  OTP expires in ${OTP_TTL_SECONDS} seconds`);

  const otpData = {
    hash: hashed,
    phone,
    deviceId: deviceId || null,
    createdAt: Date.now(),
    attempts: 0,
  };

  await redis.setex(`otp:${phone}`, OTP_TTL_SECONDS, JSON.stringify(otpData));
  await redis.del(`otp:attempts:${phone}`);

  // Log OTP in a beautiful box
  const timestamp = new Date().toLocaleTimeString();
  console.log(
    `\n╔════════════════════════════════════════════════════════════════════════════╗`,
  );
  console.log(
    `║  🔐 OTP VERIFICATION CODE                                                       ║`,
  );
  console.log(
    `╠════════════════════════════════════════════════════════════════════════════╣`,
  );
  console.log(
    `║  Purpose: LOGIN                                                           ║`,
  );
  console.log(`║  Phone:   ${phone.padEnd(66)}║`);
  console.log(`║  OTP:     \x1b[32m${otp.padEnd(66)}\x1b[0m║`);
  console.log(`║  Time:    ${timestamp.padEnd(66)}║`);
  console.log(`║  Expires: 5 minutes${" ".padEnd(57)}║`);
  console.log(
    `╚════════════════════════════════════════════════════════════════════════════╝\n`,
  );

  if (process.env.NODE_ENV !== "production") {
    logger.info({ phone, devCode: otp }, "[DEV] OTP sent");
  }

  const response = {
    message: "OTP sent successfully",
    expiresIn: OTP_TTL_SECONDS,
  };

  // Return OTP in development for easy testing
  if (process.env.NODE_ENV !== "production") {
    response.devCode = otp;
  }

  return response;
};

// =============================================================================
// PARENT LOGIN: VERIFY OTP (FIXED - No automatic user creation)
// =============================================================================

export const verifyOtp = async ({ phone, otp, ipAddress, deviceInfo }) => {
  console.log(`\n🔑 [OTP VERIFY] Phone: ${phone}, OTP: ${otp}`);

  const attempts = parseInt(
    (await redis.get(`otp:attempts:${phone}`)) ?? "0",
    10,
  );

  console.log(`📊 Attempt count: ${attempts}/${OTP_MAX_ATTEMPTS}`);

  if (attempts >= OTP_MAX_ATTEMPTS) {
    console.log(`❌ [OTP FAILED] Too many attempts for ${phone}`);
    await recordFailedAuth(ipAddress, phone, "OTP_MAX_ATTEMPTS_EXCEEDED");
    throw ApiError.tooManyRequests("Too many OTP attempts. Try again later.");
  }

  const storedData = await redis.get(`otp:${phone}`);
  if (!storedData) {
    console.log(`❌ [OTP FAILED] OTP expired for ${phone}`);
    await recordFailedAuth(ipAddress, phone, "OTP_EXPIRED");
    throw ApiError.badRequest("OTP expired or not requested");
  }

  const otpData = JSON.parse(storedData);
  const inputHash = hashOtp(otp);
  const storedBuf = Buffer.from(otpData.hash, "hex");
  const inputBuf = Buffer.from(inputHash, "hex");

  const valid =
    storedBuf.length === inputBuf.length &&
    crypto.timingSafeEqual(storedBuf, inputBuf);

  if (!valid) {
    await redis.incr(`otp:attempts:${phone}`);
    console.log(`❌ [OTP FAILED] Invalid OTP for ${phone}`);
    await recordFailedAuth(ipAddress, phone, "INVALID_OTP");
    throw ApiError.unauthorized("Invalid OTP");
  }

  console.log(`✅ [OTP SUCCESS] Verified for ${phone}`);

  await Promise.all([
    redis.del(`otp:${phone}`),
    redis.del(`otp:attempts:${phone}`),
  ]);

  const phoneIndex = hashForLookup(phone);

  // ✅ FIX: Find existing parent ONLY - do NOT create
  let parent = await repo.findParentByPhoneIndex(phoneIndex);

  // ✅ FIX: If user doesn't exist, throw error to redirect to registration
  if (!parent) {
    console.log(`❌ [LOGIN FAILED] User not found for phone: ${phone}`);
    throw ApiError.notFound(
      "Account not found. Please register first using your RESQID card.",
    );
  }

  if (parent.status !== "ACTIVE") {
    console.log(`❌ [OTP FAILED] Account suspended for ${phone}`);
    throw ApiError.forbidden("Account suspended");
  }

  const sessionId = crypto.randomUUID();
  const deviceFingerprint = generateDeviceFingerprint({
    headers: { "user-agent": deviceInfo?.userAgent },
    ip: ipAddress,
  });

  const { accessToken, refreshToken, refreshHash, expiresAt } = issueTokenPair({
    userId: parent.id,
    role: "PARENT_USER",
    sessionId,
    deviceFingerprint,
  });

  await repo.createSession({
    id: sessionId,
    parentUserId: parent.id,
    ipAddress,
    deviceInfo,
    expiresAt,
    refreshHash,
    deviceFingerprint,
  });

  await repo.updateParentLastLogin(parent.id).catch(() => {});
  await recordSuccessfulAuth(ipAddress, parent.id, "PARENT_USER");

  const children = await prisma.parentStudent.findMany({
    where: { parent_id: parent.id },
    take: 1,
  });

  console.log(
    `✅ [LOGIN SUCCESS] Parent ${parent.id} - ${children.length} child(ren)`,
  );

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: expiresAt,
    token_type: "Bearer",
    is_new_user: false, // ✅ Always false for login
    parent_id: parent.id,
    has_children: children.length > 0,
  };
};

// =============================================================================
// PARENT REGISTRATION: STEP 1 — INIT
// =============================================================================

export const registerInit = async ({ card_number, phone, ipAddress }) => {
  console.log(`\n📇 [REGISTER INIT] Card: ${card_number}, Phone: ${phone}`);

  const card = await repo.findCardForRegistration(card_number);

  if (!card) {
    console.log(`❌ [REGISTER FAILED] Card not found: ${card_number}`);
    await recordFailedAuth(ipAddress, card_number, "INVALID_CARD_NUMBER");
    throw ApiError.notFound(
      "Card not found. Check the number printed on your physical card.",
    );
  }

  if (card.student_id && card.student?.parents?.length > 0) {
    console.log(`❌ [REGISTER FAILED] Card already registered: ${card_number}`);
    await recordFailedAuth(ipAddress, card_number, "CARD_ALREADY_REGISTERED");
    throw ApiError.conflict(
      "This card is already registered. Sign in instead.",
    );
  }

  if (card.student_id && !card.student?.is_active) {
    throw ApiError.badRequest(
      "This card is linked to an inactive student. Contact your school.",
    );
  }

  const nonce = crypto.randomBytes(32).toString("hex");
  const nonceData = JSON.stringify({
    card_id: card.id,
    card_number,
    school_id: card.school_id,
    student_id: card.student_id ?? null,
    phone,
    ip: ipAddress,
  });

  await redis.setex(`reg:nonce:${nonce}`, NONCE_TTL, nonceData);

  const otp = generateOtp();
  const hashed = hashOtp(otp);

  const otpData = {
    hash: hashed,
    phone,
    purpose: "registration",
    attempts: 0,
  };

  await Promise.all([
    redis.setex(`otp:${phone}`, OTP_TTL_SECONDS, JSON.stringify(otpData)),
    redis.del(`otp:attempts:${phone}`),
  ]);

  console.log(`🔐 [REGISTRATION OTP] Phone: ${phone}, OTP: ${otp}`);
  console.log(`📝 [REGISTRATION OTP] Nonce: ${nonce.slice(0, 16)}...`);

  // Display OTP in a beautiful box for registration
  const timestamp = new Date().toLocaleTimeString();
  console.log(
    `\n╔════════════════════════════════════════════════════════════════════════════╗`,
  );
  console.log(
    `║  🔐 OTP VERIFICATION CODE (REGISTRATION)                                      ║`,
  );
  console.log(
    `╠════════════════════════════════════════════════════════════════════════════╣`,
  );
  console.log(
    `║  Purpose: REGISTRATION                                                    ║`,
  );
  console.log(`║  Card:    ${card_number.padEnd(66)}║`);
  console.log(`║  Phone:   ${phone.padEnd(66)}║`);
  console.log(`║  OTP:     \x1b[32m${otp.padEnd(66)}\x1b[0m║`);
  console.log(`║  Time:    ${timestamp.padEnd(66)}║`);
  console.log(`║  Expires: 5 minutes${" ".padEnd(57)}║`);
  console.log(
    `╚════════════════════════════════════════════════════════════════════════════╝\n`,
  );

  if (process.env.NODE_ENV !== "production") {
    logger.info({ phone, devCode: otp }, "[DEV] Registration OTP");
  }

  const maskedPhone = phone.replace(/(\+\d{2})(\d{5})(\d{5})/, "$1 *****$3");

  return {
    nonce,
    masked_phone: maskedPhone,
    student_first_name: card.student?.first_name ?? null,
    devCode: process.env.NODE_ENV !== "production" ? otp : undefined,
  };
};

// =============================================================================
// PARENT REGISTRATION: STEP 2 — VERIFY
// =============================================================================

export const registerVerify = async ({
  nonce,
  otp,
  phone,
  ipAddress,
  deviceInfo,
}) => {
  console.log(
    `\n✅ [REGISTER VERIFY] Phone: ${phone}, Nonce: ${nonce.slice(0, 16)}...`,
  );

  const attempts = parseInt(
    (await redis.get(`otp:attempts:${phone}`)) ?? "0",
    10,
  );

  console.log(`📊 Attempt count: ${attempts}/${OTP_MAX_ATTEMPTS}`);

  if (attempts >= OTP_MAX_ATTEMPTS) {
    console.log(`❌ [REGISTER FAILED] Too many attempts for ${phone}`);
    await recordFailedAuth(ipAddress, phone, "REGISTRATION_OTP_MAX_ATTEMPTS");
    throw ApiError.tooManyRequests("Too many OTP attempts. Try again later.");
  }

  const storedData = await redis.get(`otp:${phone}`);
  if (!storedData) {
    console.log(`❌ [REGISTER FAILED] OTP expired for ${phone}`);
    await recordFailedAuth(ipAddress, phone, "REGISTRATION_OTP_EXPIRED");
    throw ApiError.badRequest("OTP expired. Request a new code.");
  }

  const otpData = JSON.parse(storedData);
  const inputHash = hashOtp(otp);
  const storedBuf = Buffer.from(otpData.hash, "hex");
  const inputBuf = Buffer.from(inputHash, "hex");

  const valid =
    storedBuf.length === inputBuf.length &&
    crypto.timingSafeEqual(storedBuf, inputBuf);

  if (!valid) {
    await redis.incr(`otp:attempts:${phone}`);
    console.log(`❌ [REGISTER FAILED] Invalid OTP for ${phone}`);
    await recordFailedAuth(ipAddress, phone, "REGISTRATION_INVALID_OTP");
    throw ApiError.unauthorized("Invalid OTP");
  }

  const nonceRaw = await redis.get(`reg:nonce:${nonce}`);
  if (!nonceRaw) {
    console.log(`❌ [REGISTER FAILED] Nonce expired: ${nonce.slice(0, 16)}...`);
    await recordFailedAuth(ipAddress, phone, "REGISTRATION_NONCE_EXPIRED");
    throw ApiError.badRequest(
      "Registration session expired. Please start again.",
    );
  }

  const nonceData = JSON.parse(nonceRaw);

  if (nonceData.phone !== phone) {
    console.log(
      `❌ [REGISTER FAILED] Phone mismatch: expected ${nonceData.phone}, got ${phone}`,
    );
    await recordFailedAuth(ipAddress, phone, "REGISTRATION_PHONE_MISMATCH");
    throw ApiError.badRequest(
      "Phone number mismatch. Please start registration again.",
    );
  }

  console.log(`✅ [OTP SUCCESS] Verified for registration: ${phone}`);

  const phoneIndex = hashForLookup(phone);

  const { parent, studentId, isNewUser } = await prisma.$transaction(
    async (tx) => {
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
        console.log(`👤 [NEW USER] Created parent account for ${phone}`);
      }

      let resolvedStudentId = nonceData.student_id;

      if (!resolvedStudentId) {
        const stubStudent = await repo.createStubStudent(nonceData.school_id);
        resolvedStudentId = stubStudent.id;
        console.log(
          `👶 [NEW STUDENT] Created stub student: ${resolvedStudentId}`,
        );

        await repo.createEmergencyProfile(resolvedStudentId);
        await repo.updateCardStudent(nonceData.card_id, resolvedStudentId);
      }

      const cardWithToken = await repo.findCardWithToken(nonceData.card_id);

      if (cardWithToken?.token_id) {
        await repo.updateTokenStudent(
          cardWithToken.token_id,
          resolvedStudentId,
        );
        console.log(
          `🔑 [TOKEN LINKED] Token ${cardWithToken.token_id} linked to student`,
        );
      }

      await repo.linkParentToStudent(existing.id, resolvedStudentId);
      await repo.createParentNotificationPref(existing.id);

      return {
        parent: existing,
        studentId: resolvedStudentId,
        isNewUser: isNew,
      };
    },
  );

  await Promise.all([
    redis.del(`reg:nonce:${nonce}`),
    redis.del(`otp:${phone}`),
    redis.del(`otp:attempts:${phone}`),
  ]);

  const sessionId = crypto.randomUUID();
  const deviceFingerprint = generateDeviceFingerprint({
    headers: { "user-agent": deviceInfo?.userAgent },
    ip: ipAddress,
  });

  const { accessToken, refreshToken, refreshHash, expiresAt } = issueTokenPair({
    userId: parent.id,
    role: "PARENT_USER",
    sessionId,
    deviceFingerprint,
  });

  await repo.createSession({
    id: sessionId,
    parentUserId: parent.id,
    ipAddress,
    deviceInfo,
    expiresAt,
    refreshHash,
    deviceFingerprint,
  });

  await repo.updateParentLastLogin(parent.id).catch(() => {});
  await recordSuccessfulAuth(ipAddress, parent.id, "PARENT_USER");

  console.log(
    `✅ [REGISTRATION SUCCESS] Parent: ${parent.id}, Student: ${studentId}`,
  );

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: expiresAt,
    token_type: "Bearer",
    is_new_user: isNewUser,
    parent_id: parent.id,
    student_id: studentId,
  };
};

// =============================================================================
// REFRESH TOKENS
// =============================================================================

export const refreshTokens = async ({
  refreshToken,
  ipAddress,
  deviceInfo,
}) => {
  console.log(`\n🔄 [REFRESH TOKEN] IP: ${ipAddress}`);

  const hash = hashToken(refreshToken);

  const isBlacklisted = await redis.get(`blacklist:${hash}`);
  if (isBlacklisted) {
    const meta = JSON.parse(isBlacklisted);
    if (meta?.userId && meta?.role) {
      console.log(
        `⚠️ [REFRESH TOKEN REUSE DETECTED] User: ${meta.userId}, Role: ${meta.role}`,
      );
      await recordFailedAuth(ipAddress, meta.userId, "REFRESH_TOKEN_REUSE");
      logger.error(
        { userId: meta.userId, role: meta.role, ip: ipAddress },
        "Refresh token reuse detected",
      );
      await repo.revokeAllUserSessions(meta.userId, meta.role);
    }
    throw ApiError.unauthorized("Security alert: please log in again");
  }

  const session = await repo.findSessionByRefreshHash(hash);

  if (!session || !session.is_active) {
    console.log(`❌ [REFRESH TOKEN] Invalid session`);
    await recordFailedAuth(ipAddress, null, "INVALID_REFRESH_SESSION");
    throw ApiError.unauthorized("Session invalid");
  }
  if (session.expires_at < new Date()) {
    console.log(`❌ [REFRESH TOKEN] Session expired`);
    await recordFailedAuth(ipAddress, null, "EXPIRED_REFRESH_SESSION");
    throw ApiError.sessionExpired();
  }

  let role, userId, schoolId;

  if (session.admin_user_id) {
    role = "SUPER_ADMIN";
    userId = session.admin_user_id;
  } else if (session.school_user_id) {
    role = "ADMIN";
    userId = session.school_user_id;
    const user = await repo.findSchoolUserById(userId);
    schoolId = user?.school_id;
  } else if (session.parent_user_id) {
    role = "PARENT_USER";
    userId = session.parent_user_id;
  } else {
    throw ApiError.unauthorized("Invalid session");
  }

  console.log(`✅ [REFRESH TOKEN] User: ${userId}, Role: ${role}`);

  const {
    accessToken,
    refreshToken: newRefresh,
    refreshHash,
    expiresAt,
  } = issueTokenPair({
    userId,
    role,
    sessionId: session.id,
    schoolId,
  });

  await repo.updateSessionRefreshHash(session.id, refreshHash);

  const oldHashTtl = Math.ceil((session.expires_at - Date.now()) / 1000);
  if (oldHashTtl > 0) {
    await redis
      .setex(`blacklist:${hash}`, oldHashTtl, JSON.stringify({ userId, role }))
      .catch(() => {});
  }

  return {
    access_token: accessToken,
    refresh_token: newRefresh,
    expires_at: expiresAt,
    token_type: "Bearer",
  };
};

// =============================================================================
// LOGOUT
// =============================================================================

export const logoutUser = async ({
  token,
  exp,
  refreshToken,
  sessionId,
  userId,
  role,
}) => {
  console.log(
    `\n🚪 [LOGOUT] User: ${userId}, Role: ${role}, Session: ${sessionId}`,
  );

  const ops = [];

  const accessHash = hashToken(token);
  ops.push(repo.addToBlacklist(accessHash, new Date(exp * 1000)));
  ops.push(
    redis.setex(
      `blacklist:${accessHash}`,
      exp - Math.floor(Date.now() / 1000),
      "1",
    ),
  );

  if (sessionId) {
    ops.push(repo.revokeSession(sessionId, "MANUAL_LOGOUT"));
  }

  if (refreshToken) {
    const refreshHash = hashToken(refreshToken);
    ops.push(
      repo.addToBlacklist(
        refreshHash,
        new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      ),
    );
  }

  await Promise.all(ops);

  if (sessionId) {
    await redis.del(`session:${sessionId}`).catch(() => {});
  }
  if (userId && role) {
    await redis.del(`user:${role}:${userId}`).catch(() => {});
  }

  console.log(`✅ [LOGOUT SUCCESS] User: ${userId}`);
};

// =============================================================================
// CHANGE PASSWORD
// =============================================================================

export const changePassword = async ({
  userId,
  role,
  oldPassword,
  newPassword,
  ipAddress,
}) => {
  console.log(`\n🔒 [CHANGE PASSWORD] User: ${userId}, Role: ${role}`);

  let user, passwordHash;

  if (role === "SUPER_ADMIN") {
    user = await repo.findSuperAdminById(userId);
    passwordHash = user?.password_hash;
  } else if (role === "ADMIN") {
    user = await repo.findSchoolUserById(userId);
    passwordHash = user?.password_hash;
  } else if (role === "PARENT_USER") {
    user = await repo.findParentById(userId);
    passwordHash = user?.password_hash;
  } else {
    throw ApiError.badRequest("Invalid user type");
  }

  if (!user) throw ApiError.notFound("User not found");

  const isValid = await verifyPassword(oldPassword, passwordHash);
  if (!isValid) {
    console.log(`❌ [CHANGE PASSWORD] Invalid old password for user ${userId}`);
    await recordFailedAuth(ipAddress, userId, "INVALID_OLD_PASSWORD");
    throw ApiError.unauthorized("Invalid current password");
  }

  const hashedPassword = await bcrypt.hash(newPassword, 12);

  if (role === "SUPER_ADMIN") {
    await repo.updateSuperAdminPassword(userId, hashedPassword);
  } else if (role === "ADMIN") {
    await repo.updateSchoolUserPassword(userId, hashedPassword);
  } else {
    await repo.updateParentPassword(userId, hashedPassword);
  }

  await repo.revokeAllUserSessions(userId, role, "PASSWORD_CHANGED");

  await repo
    .createAuditLog({
      actorId: userId,
      actorType: role,
      action: "PASSWORD_CHANGED",
      entity: role,
      entityId: userId,
      ip: ipAddress,
    })
    .catch(() => {});

  console.log(`✅ [CHANGE PASSWORD SUCCESS] User: ${userId}`);

  return { message: "Password changed successfully. Please login again." };
};
