// =============================================================================
// src/services/auth/auth.service.js — RESQID (FIXED)
// =============================================================================

import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { redis } from '#config/redis.js';
import { ApiError } from '#shared/response/ApiError.js';
import { verifyPassword, hashToken } from '#shared/security/hashUtil.js';
import { encryptField, hashForLookup } from '#shared/security/encryption.js';
import { issueTokenPair } from '#shared/security/jwt.js';
import { generateOtp, hashOtp } from '#services/otp.service.js';
import { generateDeviceFingerprint } from '#shared/security/deviceFingerprint.js';
import { logger } from '#config/logger.js';
import { ENV } from '#config/env.js';

// Behavioral security imports
import {
  recordFailedAuth,
  recordSuccessfulAuth,
} from '#middleware/security/behavioralSecurity.middleware.js';

// Repository imports
import * as repo from './auth.repository.js';

// notification publisher
import { publishNotification } from '#orchestrator/notifications/notification.publisher.js';

// =============================================================================
// CONSTANTS
// =============================================================================

const OTP_TTL_SECONDS = 15 * 60; // 15 minutes
const OTP_MAX_ATTEMPTS = 5;
const NONCE_TTL = 10 * 60;

// =============================================================================
// HELPER FUNCTIONS (Extracted to eliminate duplication)
// =============================================================================
async function dispatchOtp({ phone, otp, namespace, actorId, expiryMinutes }) {
  if (ENV.IS_DEV) {
    logger.info({ phone, otp, namespace }, '[DEV OTP]');
    return;
  }
  await publishNotification.otpRequested({
    actorId,
    payload: { phone, otp, namespace, expiryMinutes },
  });
}

/**
 * validateOtp
 * Centralized OTP validation logic
 * Returns validated phone on success, throws on failure
 */
async function validateOtp(phone, otp, ipAddress, namespace = 'LOGIN') {
  const key = `otp:${namespace}:${phone}`;
  const attemptsKey = `otp:attempts:${namespace}:${phone}`;

  const [attemptsRaw, storedData] = await redis.pipeline().get(attemptsKey).get(key).exec();

  const attempts = parseInt(attemptsRaw?.[1] ?? '0', 10);
  if (attempts >= OTP_MAX_ATTEMPTS) {
    await recordFailedAuth(ipAddress, phone, `${namespace}_OTP_MAX_ATTEMPTS`);
    throw ApiError.tooManyRequests('Too many OTP attempts. Try again later.');
  }

  if (!storedData?.[1]) {
    await recordFailedAuth(ipAddress, phone, `${namespace}_OTP_EXPIRED`);
    throw ApiError.badRequest('OTP expired or not requested');
  }

  const otpData = JSON.parse(storedData[1]);
  const inputHash = hashOtp(otp);
  const storedBuf = Buffer.from(otpData.hash, 'hex');
  const inputBuf = Buffer.from(inputHash, 'hex');
  const valid = storedBuf.length === inputBuf.length && crypto.timingSafeEqual(storedBuf, inputBuf);

  if (!valid) {
    await redis.incr(attemptsKey);
    await recordFailedAuth(ipAddress, phone, `${namespace}_INVALID_OTP`);
    throw ApiError.unauthorized('Invalid OTP');
  }

  await Promise.all([redis.del(key), redis.del(attemptsKey)]);
  return true;
}

/**
 * createUserSession
 * Centralized session creation logic
 */
async function createUserSession({
  userId,
  role,
  sessionId,
  ipAddress,
  deviceInfo,
  deviceFingerprint,
}) {
  const { accessToken, refreshToken, refreshHash, expiresAt } = issueTokenPair({
    userId,
    role,
    sessionId,
    deviceFingerprint,
  });

  await repo.createSession({
    id: sessionId,
    ...(role === 'SUPER_ADMIN' && { superAdminId: userId }),
    ...(role === 'ADMIN' && { schoolUserId: userId }),
    ...(role === 'PARENT_USER' && { parentUserId: userId }),
    ipAddress,
    deviceInfo,
    expiresAt,
    refreshHash,
    deviceFingerprint,
  });

  return { accessToken, refreshToken, expiresAt };
}

/**
 * updateLastLogin
 * Centralized last login update
 */
async function updateLastLogin(role, userId) {
  if (role === 'SUPER_ADMIN') {
    await repo.updateSuperAdminLastLogin(userId).catch(() => {});
  } else if (role === 'ADMIN') {
    await repo.updateSchoolUserLastLogin(userId).catch(() => {});
  } else if (role === 'PARENT_USER') {
    await repo.updateParentLastLogin(userId).catch(() => {});
  }
}

// =============================================================================
// SUPER ADMIN LOGIN
// =============================================================================

export const loginSuperAdmin = async ({ email, password, ipAddress, deviceInfo, userAgent }) => {
  console.log(`\n🔐 [SUPER ADMIN LOGIN] Email: ${email} from ${ipAddress}`);

  const admin = await repo.findSuperAdminByEmail(email);

  const valid = await verifyPassword(
    password,
    admin?.password_hash ?? '$2b$12$invalidhashfortimingprotection'
  );

  if (!admin || !valid) {
    console.log(
      `❌ [SUPER ADMIN LOGIN FAILED] Email: ${email} - ${!admin ? 'User not found' : 'Wrong password'}`
    );

    await recordFailedAuth(ipAddress, email, 'INVALID_CREDENTIALS');
    await repo.logFailedLogin({
      actorType: 'SUPER_ADMIN',
      identifier: email,
      ipAddress,
      userAgent,
      reason: 'INVALID_CREDENTIALS',
    });

    throw ApiError.unauthorized('Invalid credentials');
  }

  if (!admin.is_active) {
    console.log(`❌ [SUPER ADMIN LOGIN FAILED] Account disabled: ${email}`);
    throw ApiError.forbidden('Account disabled');
  }

  const sessionId = crypto.randomUUID();
  const { accessToken, refreshToken, expiresAt } = await createUserSession({
    userId: admin.id,
    role: 'SUPER_ADMIN',
    sessionId,
    ipAddress,
    deviceInfo,
  });

  await updateLastLogin('SUPER_ADMIN', admin.id);
  await recordSuccessfulAuth(ipAddress, admin.id, 'SUPER_ADMIN');

  await repo
    .createAuditLog({
      actorId: admin.id,
      actorType: 'SUPER_ADMIN',
      action: 'LOGIN',
      entity: 'SuperAdmin',
      entityId: admin.id,
      ip: ipAddress,
      ua: userAgent,
    })
    .catch(() => {});

  console.log(`✅ [SUPER ADMIN LOGIN SUCCESS] ${admin.email}`);

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: expiresAt,
    user: {
      id: admin.id,
      name: admin.name,
      email: admin.email,
      role: 'SUPER_ADMIN',
    },
  };
};

// =============================================================================
// SCHOOL ADMIN LOGIN
// =============================================================================

export const loginSchoolUser = async ({ email, password, ipAddress, deviceInfo, userAgent }) => {
  console.log(`\n🏫 [SCHOOL ADMIN LOGIN] Email: ${email} from ${ipAddress}`);

  const user = await repo.findSchoolUserByEmail(email);

  const valid = await verifyPassword(
    password,
    user?.password_hash ?? '$2b$12$invalidhashfortimingprotection'
  );

  if (!user || !valid) {
    console.log(`❌ [SCHOOL ADMIN LOGIN FAILED] Email: ${email}`);

    await recordFailedAuth(ipAddress, email, 'INVALID_CREDENTIALS');
    await repo.logFailedLogin({
      actorType: 'ADMIN',
      identifier: email,
      ipAddress,
      userAgent,
      reason: 'INVALID_CREDENTIALS',
    });

    throw ApiError.unauthorized('Invalid credentials');
  }

  if (!user.is_active) {
    console.log(`❌ [SCHOOL ADMIN LOGIN FAILED] Account disabled: ${email}`);
    throw ApiError.forbidden('Account disabled');
  }

  const sessionId = crypto.randomUUID();
  const { accessToken, refreshToken, expiresAt } = await createUserSession({
    userId: user.id,
    role: 'ADMIN',
    sessionId,
    ipAddress,
    deviceInfo,
  });

  await updateLastLogin('ADMIN', user.id);
  await recordSuccessfulAuth(ipAddress, user.id, 'ADMIN');

  await repo
    .createAuditLog({
      actorId: user.id,
      actorType: 'ADMIN',
      action: 'LOGIN',
      entity: 'SchoolUser',
      entityId: user.id,
      ip: ipAddress,
      ua: userAgent,
    })
    .catch(() => {});

  console.log(`✅ [SCHOOL ADMIN LOGIN SUCCESS] ${user.email} (School: ${user.school_id})`);

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: expiresAt,
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

  // Rate limiting
  const phoneKey = `otp:phone:${hashForLookup(phone)}`;
  const phoneAttempts = await redis.incr(phoneKey);
  if (phoneAttempts === 1) await redis.expire(phoneKey, 3600);

  if (phoneAttempts > 5) {
    console.log(`❌ [OTP BLOCKED] Phone ${phone} exceeded limit`);
    await recordFailedAuth(ipAddress, phone, 'OTP_PHONE_LIMIT_EXCEEDED');
    throw ApiError.tooManyRequests('Too many OTP requests. Try after 1 hour.');
  }

  const ipKey = `otp:ip:${ipAddress}`;
  const ipAttempts = await redis.incr(ipKey);
  if (ipAttempts === 1) await redis.expire(ipKey, 3600);

  if (ipAttempts > 20) {
    console.log(`❌ [OTP BLOCKED] IP ${ipAddress} exceeded limit`);
    await recordFailedAuth(ipAddress, phone, 'OTP_IP_LIMIT_EXCEEDED');
    throw ApiError.tooManyRequests('Too many OTP requests from this IP.');
  }

  // Generate OTP
  const otp = generateOtp();
  const hashed = hashOtp(otp);

  const otpData = {
    hash: hashed,
    phone,
    deviceId: deviceId || null,
    createdAt: Date.now(),
    attempts: 0,
  };

  await redis.setex(`otp:login:${phone}`, OTP_TTL_SECONDS, JSON.stringify(otpData));
  await dispatchOtp({
    phone,
    otp,
    namespace: 'login',
    actorId: phone,
    expiryMinutes: OTP_TTL_SECONDS / 60,
  });
  await redis.del(`otp:attempts:login:${phone}`);

  const response = {
    message: 'OTP sent successfully',
    expiresIn: OTP_TTL_SECONDS,
  };

  return response;
};

// =============================================================================
// PARENT LOGIN: VERIFY OTP
// =============================================================================

export const verifyOtp = async ({ phone, otp, ipAddress, deviceInfo }) => {
  console.log(`\n🔑 [OTP VERIFY] Phone: ${phone}`);

  // Centralized OTP validation
  await validateOtp(phone, otp, ipAddress, 'LOGIN');

  const phoneIndex = hashForLookup(phone);
  const parent = await repo.findParentByPhoneIndex(phoneIndex);

  if (!parent) {
    console.log(`❌ [LOGIN FAILED] User not found for phone: ${phone}`);
    throw ApiError.notFound('Account not found. Please register first using your RESQID card.');
  }

  if (parent.status !== 'ACTIVE') {
    console.log(`❌ [OTP FAILED] Account suspended for ${phone}`);
    throw ApiError.forbidden('Account suspended');
  }

  const sessionId = crypto.randomUUID();
  const deviceFingerprint = generateDeviceFingerprint({
    headers: { 'user-agent': deviceInfo?.userAgent },
    ip: ipAddress,
  });

  const { accessToken, refreshToken, expiresAt } = await createUserSession({
    userId: parent.id,
    role: 'PARENT_USER',
    sessionId,
    ipAddress,
    deviceInfo,
    deviceFingerprint,
  });

  await updateLastLogin('PARENT_USER', parent.id);
  await recordSuccessfulAuth(ipAddress, parent.id, 'PARENT_USER');

  // Get parent details and preferences from repository
  const children = await repo.findParentChildren(parent.id, 1);

  console.log(`✅ [LOGIN SUCCESS] Parent ${parent.id} - ${children.length} child(ren)`);

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: expiresAt,
    token_type: 'Bearer',
    is_new_user: false,
    parent_id: parent.id,
    has_children: children.length > 0,
  };
};

// =============================================================================
// PARENT REGISTRATION: STEP 1 — INIT
// =============================================================================

export const registerInit = async ({ card_number, phone, ipAddress }) => {
  console.log(`\n📇 [REGISTER INIT] Card: ${card_number}, Phone: ${phone}`);

  // Card rate limit
  const cardKey = `reg:card:${card_number}`;
  const cardAttempts = await redis.incr(cardKey);
  if (cardAttempts === 1) await redis.expire(cardKey, 3600);
  if (cardAttempts > 5) {
    throw ApiError.tooManyRequests(
      'Too many registration attempts for this card. Try after 1 hour.'
    );
  }

  const card = await repo.findCardForRegistration(card_number);

  if (!card) {
    await recordFailedAuth(ipAddress, card_number, 'INVALID_CARD_NUMBER');
    throw ApiError.notFound('Card not found. Check the number printed on your physical card.');
  }

  // CHECK: card has existing parent with different phone
  if (card.student?.parents?.length > 0) {
    const existingPhoneIndex = card.student.parents[0].parent.phone_index;
    const incomingPhoneIndex = hashForLookup(phone);

    if (existingPhoneIndex !== incomingPhoneIndex) {
      await recordFailedAuth(ipAddress, card_number, 'PHONE_MISMATCH');
      throw ApiError.conflict(
        'This card is already linked to a different phone number. Contact your school.'
      );
    }
  }

  if (
    card.student_id &&
    card.student?.parents?.length > 0 &&
    card.student?.setup_stage !== 'PENDING'
  ) {
    await recordFailedAuth(ipAddress, card_number, 'CARD_ALREADY_REGISTERED');
    throw ApiError.conflict('This card is already registered. Sign in instead.');
  }

  if (card.student_id && !card.student?.is_active) {
    throw ApiError.badRequest('This card is linked to an inactive student. Contact your school.');
  }

  const nonce = crypto.randomBytes(32).toString('hex');
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
    purpose: 'registration',
    attempts: 0,
  };

  await Promise.all([
    redis.setex(`otp:register:${phone}`, OTP_TTL_SECONDS, JSON.stringify(otpData)),
    redis.del(`otp:attempts:register:${phone}`),
  ]);

  await dispatchOtp({
    phone,
    otp,
    namespace: 'register',
    actorId: phone,
    expiryMinutes: OTP_TTL_SECONDS / 60,
  });

  const maskedPhone = phone.replace(/(\+\d{2})(\d{5})(\d{5})/, '$1 *****$3');

  return {
    nonce,
    masked_phone: maskedPhone,
    student_first_name: card.student?.first_name ?? null,
  };
};

// =============================================================================
// PARENT REGISTRATION: STEP 2 — VERIFY
// =============================================================================

export const registerVerify = async ({ nonce, otp, phone, ipAddress, deviceInfo }) => {
  console.log(`\n✅ [REGISTER VERIFY] Phone: ${phone}, Nonce: ${nonce.slice(0, 16)}...`);

  // Centralized OTP validation
  await validateOtp(phone, otp, ipAddress, 'REGISTRATION');

  const nonceRaw = await redis.get(`reg:nonce:${nonce}`);
  if (!nonceRaw) {
    console.log(`❌ [REGISTER FAILED] Nonce expired: ${nonce.slice(0, 16)}...`);
    await recordFailedAuth(ipAddress, phone, 'REGISTRATION_NONCE_EXPIRED');
    throw ApiError.badRequest('Registration session expired. Please start again.');
  }

  const nonceData = JSON.parse(nonceRaw);

  if (nonceData.phone !== phone) {
    console.log(`❌ [REGISTER FAILED] Phone mismatch: expected ${nonceData.phone}, got ${phone}`);
    await recordFailedAuth(ipAddress, phone, 'REGISTRATION_PHONE_MISMATCH');
    throw ApiError.badRequest('Phone number mismatch. Please start registration again.');
  }

  console.log(`✅ [OTP SUCCESS] Verified for registration: ${phone}`);

  const phoneIndex = hashForLookup(phone);
  const encryptedPhone = encryptField(phone);

  // Use repository transaction for registration
  const { parent, studentId, isNewUser } = await repo.registerParentWithStudent({
    phone,
    phoneIndex,
    encryptedPhone,
    cardId: nonceData.card_id,
    schoolId: nonceData.school_id,
    existingStudentId: nonceData.student_id,
  });

  await Promise.all([
    redis.del(`reg:nonce:${nonce}`),
    redis.del(`otp:register:${phone}`),
    redis.del(`otp:attempts:register:${phone}`),
  ]);

  const sessionId = crypto.randomUUID();
  const deviceFingerprint = generateDeviceFingerprint({
    headers: { 'user-agent': deviceInfo?.userAgent },
    ip: ipAddress,
  });

  const { accessToken, refreshToken, expiresAt } = await createUserSession({
    userId: parent.id,
    role: 'PARENT_USER',
    sessionId,
    ipAddress,
    deviceInfo,
    deviceFingerprint,
  });

  await updateLastLogin('PARENT_USER', parent.id);
  await recordSuccessfulAuth(ipAddress, parent.id, 'PARENT_USER');

  console.log(`✅ [REGISTRATION SUCCESS] Parent: ${parent.id}, Student: ${studentId}`);

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: expiresAt,
    token_type: 'Bearer',
    is_new_user: isNewUser,
    parent_id: parent.id,
    student_id: studentId,
  };
};

// =============================================================================
// REFRESH TOKENS
// =============================================================================

export const refreshTokens = async ({ refreshToken, ipAddress, deviceInfo }) => {
  console.log(`\n🔄 [REFRESH TOKEN] IP: ${ipAddress}`);

  const hash = hashToken(refreshToken);

  const isBlacklisted = await redis.get(`blacklist:${hash}`);
  if (isBlacklisted) {
    const meta = JSON.parse(isBlacklisted);
    if (meta?.userId && meta?.role) {
      console.log(`⚠️ [REFRESH TOKEN REUSE DETECTED] User: ${meta.userId}, Role: ${meta.role}`);
      await recordFailedAuth(ipAddress, meta.userId, 'REFRESH_TOKEN_REUSE');
      logger.error(
        { userId: meta.userId, role: meta.role, ip: ipAddress },
        'Refresh token reuse detected'
      );
      await repo.revokeAllUserSessions(meta.userId, meta.role);
    }
    throw ApiError.unauthorized('Security alert: please log in again');
  }

  const session = await repo.findSessionByRefreshHash(hash);

  if (!session || !session.is_active) {
    console.log(`❌ [REFRESH TOKEN] Invalid session`);
    await recordFailedAuth(ipAddress, null, 'INVALID_REFRESH_SESSION');
    throw ApiError.unauthorized('Session invalid');
  }
  if (session.expires_at < new Date()) {
    console.log(`❌ [REFRESH TOKEN] Session expired`);
    await recordFailedAuth(ipAddress, null, 'EXPIRED_REFRESH_SESSION');
    throw ApiError.sessionExpired();
  }

  let role, userId, schoolId;

  if (session.admin_user_id) {
    role = 'SUPER_ADMIN';
    userId = session.admin_user_id;
  } else if (session.school_user_id) {
    role = 'ADMIN';
    userId = session.school_user_id;
    const user = await repo.findSchoolUserById(userId);
    schoolId = user?.school_id;
  } else if (session.parent_user_id) {
    role = 'PARENT_USER';
    userId = session.parent_user_id;
  } else {
    throw ApiError.unauthorized('Invalid session');
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

  const oldHashTtl = Math.ceil((session.expires_at.getTime() - Date.now()) / 1000);
  if (oldHashTtl > 0) {
    await redis
      .setex(`blacklist:${hash}`, oldHashTtl, JSON.stringify({ userId, role }))
      .catch(() => {});
  }

  return {
    access_token: accessToken,
    refresh_token: newRefresh,
    expires_at: expiresAt,
    token_type: 'Bearer',
  };
};

// =============================================================================
// LOGOUT
// =============================================================================

export const logoutUser = async ({ token, exp, refreshToken, sessionId, userId, role }) => {
  console.log(`\n🚪 [LOGOUT] User: ${userId}, Role: ${role}, Session: ${sessionId}`);

  const ops = [];

  const accessHash = hashToken(token);
  const expMs = exp * 1000;
  if (expMs > Date.now()) {
    ops.push(repo.addToBlacklist(accessHash, new Date(expMs)));
  }
  ops.push(redis.setex(`blacklist:${accessHash}`, exp - Math.floor(Date.now() / 1000), '1'));

  if (sessionId) {
    ops.push(repo.revokeSession(sessionId, 'MANUAL_LOGOUT'));
  }

  if (refreshToken) {
    const refreshHash = hashToken(refreshToken);
    ops.push(repo.addToBlacklist(refreshHash, new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)));
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

export const changePassword = async ({ userId, role, oldPassword, newPassword, ipAddress }) => {
  console.log(`\n🔒 [CHANGE PASSWORD] User: ${userId}, Role: ${role}`);

  if (role === 'PARENT_USER') {
    throw ApiError.badRequest('Password change not supported for parent accounts. Use OTP login.');
  }

  let user, passwordHash, email, name;

  if (role === 'SUPER_ADMIN') {
    user = await repo.findSuperAdminById(userId);
    passwordHash = user?.password_hash;
    email = user?.email;
    name = user?.name;
  } else if (role === 'ADMIN') {
    user = await repo.findSchoolUserById(userId);
    passwordHash = user?.password_hash;
    email = user?.email;
    name = user?.name;
  } else {
    throw ApiError.badRequest('Invalid user type');
  }

  if (!user) throw ApiError.notFound('User not found');

  const isValid = await verifyPassword(oldPassword, passwordHash);
  if (!isValid) {
    console.log(`❌ [CHANGE PASSWORD] Invalid old password for user ${userId}`);
    await recordFailedAuth(ipAddress, userId, 'INVALID_OLD_PASSWORD');
    throw ApiError.unauthorized('Invalid current password');
  }

  const hashedPassword = await bcrypt.hash(newPassword, 12);

  if (role === 'SUPER_ADMIN') {
    await repo.updateSuperAdminPassword(userId, hashedPassword);
  } else if (role === 'ADMIN') {
    await repo.updateSchoolUserPassword(userId, hashedPassword);
  }

  await repo.revokeAllUserSessions(userId, role, 'PASSWORD_CHANGED');

  await repo
    .createAuditLog({
      actorId: userId,
      actorType: role,
      action: 'PASSWORD_CHANGED',
      entity: role,
      entityId: userId,
      ip: ipAddress,
    })
    .catch(() => {});

  console.log(`✅ [CHANGE PASSWORD SUCCESS] User: ${userId}`);

  return { message: 'Password changed successfully. Please login again.' };
};

// =============================================================================
// CHANGE PHONE NUMBER
// =============================================================================

/**
 * Initiate phone number change for parent user
 * Sends OTP to new phone number for verification
 */
export const initiatePhoneChange = async ({ userId, newPhone, ipAddress }) => {
  console.log(`\n📱 [PHONE CHANGE INIT] User: ${userId}, New Phone: ${newPhone}`);

  // Check if phone already exists
  const phoneIndex = hashForLookup(newPhone);
  const existingUser = await repo.findParentByPhoneIndex(phoneIndex);
  if (existingUser) {
    throw ApiError.conflict('Phone number already registered with another account');
  }

  // Rate limiting
  const phoneKey = `phone_change:${hashForLookup(newPhone)}`;
  const attempts = await redis.incr(phoneKey);
  if (attempts === 1) await redis.expire(phoneKey, 3600);
  if (attempts > 3) {
    throw ApiError.tooManyRequests('Too many phone change attempts. Try after 1 hour.');
  }

  // Generate OTP
  const otp = generateOtp();
  const hashed = hashOtp(otp);
  const changeToken = crypto.randomBytes(32).toString('hex');

  const changeData = {
    userId,
    newPhone,
    newPhoneIndex: phoneIndex,
    otpHash: hashed,
    attempts: 0,
    createdAt: Date.now(),
  };

  await redis.setex(`phone_change:${changeToken}`, OTP_TTL_SECONDS, JSON.stringify(changeData));

  await dispatchOtp({
    phone: newPhone,
    otp,
    namespace: 'phone_change',
    actorId: userId,
    expiryMinutes: OTP_TTL_SECONDS / 60,
  });

  console.log(`✅ [PHONE CHANGE INIT] OTP sent to ${newPhone}`);

  return {
    changeToken,
    expiresIn: OTP_TTL_SECONDS,
  };
};

/**
 * Verify OTP and complete phone number change
 */
export const verifyPhoneChange = async ({ changeToken, otp, ipAddress }) => {
  console.log(`\n🔑 [PHONE CHANGE VERIFY] Token: ${changeToken.slice(0, 16)}...`);

  const changeDataRaw = await redis.get(`phone_change:${changeToken}`);
  if (!changeDataRaw) {
    throw ApiError.badRequest('Phone change session expired or invalid');
  }

  const changeData = JSON.parse(changeDataRaw);

  // Check attempts
  if (changeData.attempts >= OTP_MAX_ATTEMPTS) {
    await redis.del(`phone_change:${changeToken}`);
    throw ApiError.tooManyRequests('Too many attempts. Please start again.');
  }

  // Verify OTP
  const inputHash = hashOtp(otp);
  const storedBuf = Buffer.from(changeData.otpHash, 'hex');
  const inputBuf = Buffer.from(inputHash, 'hex');

  const valid = storedBuf.length === inputBuf.length && crypto.timingSafeEqual(storedBuf, inputBuf);

  if (!valid) {
    changeData.attempts++;
    await redis.set(`phone_change:${changeToken}`, JSON.stringify(changeData), 'KEEPTTL');
    throw ApiError.unauthorized('Invalid OTP');
  }

  // Get user details before update
  const parent = await repo.findParentWithDetails(changeData.userId);

  if (!parent) {
    throw ApiError.notFound('User not found');
  }

  // Update phone number
  const encryptedPhone = encryptField(changeData.newPhone);
  await repo.updateParentPhone(changeData.userId, encryptedPhone, changeData.newPhoneIndex);

  // Revoke all sessions
  await repo.revokeAllUserSessions(changeData.userId, 'PARENT_USER', 'PHONE_CHANGED');

  // Clean up
  await redis.del(`phone_change:${changeToken}`);

  console.log(`✅ [PHONE CHANGE SUCCESS] User: ${changeData.userId}`);

  return {
    message: 'Phone number changed successfully. Please login again.',
  };
};
