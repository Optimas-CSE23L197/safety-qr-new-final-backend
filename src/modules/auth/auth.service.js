// =============================================================================
// src/services/auth/auth.service.js — RESQID
// =============================================================================
import { prisma } from '#config/prisma.js';
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
import {
  recordFailedAuth,
  recordSuccessfulAuth,
} from '#middleware/security/behavioralSecurity.middleware.js';
import * as repo from './auth.repository.js';
import {
  sendOtp as sendOtpNotification,
  sendNewDeviceAlert,
} from '#modules/notification/notification.module.service.js';

const OTP_TTL_SECONDS = 15 * 60;
const OTP_MAX_ATTEMPTS = 5;
const NONCE_TTL = 10 * 60;

// ── Helpers ───────────────────────────────────────────────────────────────────

async function validateOtp(phone, otp, ipAddress, namespace = 'LOGIN') {
  const key = `otp:${namespace}:${phone}`;
  const attemptsKey = `otp:attempts:${namespace}:${phone}`;

  // FIX: pipeline() does NOT apply keyPrefix in ioredis — use separate awaits
  const [attemptsRaw, storedData] = await Promise.all([redis.get(attemptsKey), redis.get(key)]);

  const attempts = parseInt(attemptsRaw ?? '0', 10);

  if (attempts >= OTP_MAX_ATTEMPTS) {
    await recordFailedAuth(ipAddress, phone, `${namespace}_OTP_MAX_ATTEMPTS`);
    throw ApiError.tooManyRequests('Too many OTP attempts. Try again later.');
  }

  if (!storedData) {
    await recordFailedAuth(ipAddress, phone, `${namespace}_OTP_EXPIRED`);
    throw ApiError.badRequest('OTP expired or not requested');
  }

  const otpData = JSON.parse(storedData);
  const inputHash = hashOtp(otp);
  const storedBuf = Buffer.from(otpData.hash, 'hex');
  const inputBuf = Buffer.from(inputHash, 'hex');
  const valid = storedBuf.length === inputBuf.length && crypto.timingSafeEqual(storedBuf, inputBuf);

  if (!valid) {
    await redis.incr(attemptsKey);
    await recordFailedAuth(ipAddress, phone, `${namespace}_INVALID_OTP`);
    throw ApiError.unauthorized('Invalid OTP');
  }

  // Clear OTP, attempts, and phone rate limit on success
  const phoneRateKey = `otp:phone:${hashForLookup(phone)}`;
  await Promise.all([redis.del(key), redis.del(attemptsKey), redis.del(phoneRateKey)]);

  return true;
}

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

async function updateLastLogin(role, userId) {
  if (role === 'SUPER_ADMIN') await repo.updateSuperAdminLastLogin(userId).catch(() => {});
  else if (role === 'ADMIN') await repo.updateSchoolUserLastLogin(userId).catch(() => {});
  else if (role === 'PARENT_USER') await repo.updateParentLastLogin(userId).catch(() => {});
}

// ── Super Admin ───────────────────────────────────────────────────────────────

export const loginSuperAdmin = async ({ email, password, ipAddress, deviceInfo, userAgent }) => {
  const admin = await repo.findSuperAdminByEmail(email);
  const valid = await verifyPassword(
    password,
    admin?.password_hash ?? '$2b$12$invalidhashfortimingprotection'
  );

  if (!admin || !valid) {
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

  if (!admin.is_active) throw ApiError.forbidden('Account disabled');

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

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: expiresAt,
    user: { id: admin.id, name: admin.name, email: admin.email, role: 'SUPER_ADMIN' },
  };
};

// ── School Admin ──────────────────────────────────────────────────────────────

export const loginSchoolUser = async ({ email, password, ipAddress, deviceInfo, userAgent }) => {
  const user = await repo.findSchoolUserByEmail(email);
  const valid = await verifyPassword(
    password,
    user?.password_hash ?? '$2b$12$invalidhashfortimingprotection'
  );

  if (!user || !valid) {
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

  if (!user.is_active) throw ApiError.forbidden('Account disabled');

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

// ── Parent: OTP Request ──────────────────────────────────────────────────────

export const sendOtp = async ({ phone, ipAddress, deviceId }) => {
  const phoneKey = `otp:phone:${hashForLookup(phone)}`;
  const phoneAttempts = await redis.incr(phoneKey);
  if (phoneAttempts === 1) await redis.expire(phoneKey, 3600);
  if (phoneAttempts > 5) {
    await recordFailedAuth(ipAddress, phone, 'OTP_PHONE_LIMIT_EXCEEDED');
    throw ApiError.tooManyRequests('Too many OTP requests. Try after 1 hour.');
  }

  const ipKey = `otp:ip:${ipAddress}`;
  const ipAttempts = await redis.incr(ipKey);
  if (ipAttempts === 1) await redis.expire(ipKey, 3600);
  if (ipAttempts > 20) {
    await recordFailedAuth(ipAddress, phone, 'OTP_IP_LIMIT_EXCEEDED');
    throw ApiError.tooManyRequests('Too many OTP requests from this IP.');
  }

  const otp = generateOtp();
  if (ENV.IS_DEV) logger.info({ otp }, '[DEV] Parent login OTP');
  console.log('[DEV OTP]:', otp);

  const hashed = hashOtp(otp);
  await redis.setex(
    `otp:login:${phone}`,
    OTP_TTL_SECONDS,
    JSON.stringify({
      hash: hashed,
      phone,
      deviceId: deviceId || null,
      createdAt: Date.now(),
      attempts: 0,
    })
  );
  // await sendOtpNotification({
  //   phone,
  //   otp,
  //   namespace: 'login',
  //   expiryMinutes: OTP_TTL_SECONDS / 60,
  // });
  await redis.del(`otp:attempts:login:${phone}`);

  return { message: 'OTP sent successfully', expiresIn: OTP_TTL_SECONDS };
};

// ── Parent: OTP Verify ───────────────────────────────────────────────────────

export const verifyOtp = async ({ phone, otp, ipAddress, deviceInfo }) => {
  await validateOtp(phone, otp, ipAddress, 'login');

  const phoneIndex = hashForLookup(phone);
  const parent = await repo.findParentByPhoneIndex(phoneIndex);

  if (!parent)
    throw ApiError.notFound('Account not found. Please register first using your RESQID card.');
  if (parent.status !== 'ACTIVE') throw ApiError.forbidden('Account suspended');

  const sessionId = crypto.randomUUID();
  const deviceFingerprint = generateDeviceFingerprint({
    headers: { 'user-agent': deviceInfo?.userAgent },
    ip: ipAddress,
  });

  await upsertParentDevice({
    parentId: parent.id,
    deviceFingerprint,
    deviceInfo: { ...deviceInfo, ip: ipAddress },
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

  const children = await repo.findParentChildren(parent.id, 1);
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

// ── Parent: Register Init ────────────────────────────────────────────────────

export const registerInit = async ({ card_number, phone, ipAddress }) => {
  const cardKey = `reg:card:${card_number}`;
  const cardAttempts = await redis.incr(cardKey);
  if (cardAttempts === 1) await redis.expire(cardKey, 3600);
  if (cardAttempts > 5)
    throw ApiError.tooManyRequests(
      'Too many registration attempts for this card. Try after 1 hour.'
    );

  const card = await repo.findCardForRegistration(card_number);
  if (!card) {
    await recordFailedAuth(ipAddress, card_number, 'INVALID_CARD_NUMBER');
    throw ApiError.notFound('Card not found. Check the number printed on your physical card.');
  }

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

  if (card.student_id && !card.student?.is_active)
    throw ApiError.badRequest('This card is linked to an inactive student. Contact your school.');

  const nonce = crypto.randomBytes(32).toString('hex');
  await redis.setex(
    `reg:nonce:${nonce}`,
    NONCE_TTL,
    JSON.stringify({
      card_id: card.id,
      card_number,
      school_id: card.school_id,
      student_id: card.student_id ?? null,
      phone,
      ip: ipAddress,
    })
  );

  const otp = generateOtp();
  if (ENV.IS_DEV) logger.info({ otp }, '[DEV] Registration OTP');

  const hashed = hashOtp(otp);
  await Promise.all([
    redis.setex(
      `otp:register:${phone}`,
      OTP_TTL_SECONDS,
      JSON.stringify({ hash: hashed, phone, purpose: 'registration', attempts: 0 })
    ),
    redis.del(`otp:attempts:register:${phone}`),
  ]);

  await sendOtpNotification({
    phone,
    otp,
    namespace: 'register',
    expiryMinutes: OTP_TTL_SECONDS / 60,
  });

  const maskedPhone = phone.replace(/(\+\d{2})(\d{5})(\d{5})/, '$1 *****$3');
  return { nonce, masked_phone: maskedPhone, student_first_name: card.student?.first_name ?? null };
};

// ── Parent: Register Verify ──────────────────────────────────────────────────

export const registerVerify = async ({ nonce, otp, phone, ipAddress, deviceInfo }) => {
  await validateOtp(phone, otp, ipAddress, 'register');

  const nonceRaw = await redis.get(`reg:nonce:${nonce}`);
  if (!nonceRaw) {
    await recordFailedAuth(ipAddress, phone, 'REGISTRATION_NONCE_EXPIRED');
    throw ApiError.badRequest('Registration session expired. Please start again.');
  }

  const nonceData = JSON.parse(nonceRaw);
  if (nonceData.phone !== phone) {
    await recordFailedAuth(ipAddress, phone, 'REGISTRATION_PHONE_MISMATCH');
    throw ApiError.badRequest('Phone number mismatch. Please start registration again.');
  }

  const phoneIndex = hashForLookup(phone);
  const encryptedPhone = encryptField(phone);
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

  await upsertParentDevice({
    parentId: parent.id,
    deviceFingerprint,
    deviceInfo: { ...deviceInfo, ip: ipAddress },
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

// ── Refresh ──────────────────────────────────────────────────────────────────

export const refreshTokens = async ({ refreshToken, ipAddress }) => {
  const hash = hashToken(refreshToken);
  const isBlacklisted = await redis.get(`blacklist:${hash}`);

  if (isBlacklisted) {
    const meta = JSON.parse(isBlacklisted);
    if (meta?.userId && meta?.role) {
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
    await recordFailedAuth(ipAddress, null, 'INVALID_REFRESH_SESSION');
    throw ApiError.unauthorized('Session invalid');
  }
  if (session.expires_at < new Date()) {
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
  } else throw ApiError.unauthorized('Invalid session');

  const {
    accessToken,
    refreshToken: newRefresh,
    refreshHash,
    expiresAt,
  } = issueTokenPair({ userId, role, sessionId: session.id, schoolId });
  await repo.updateSessionRefreshHash(session.id, refreshHash);

  const oldHashTtl = Math.ceil((session.expires_at.getTime() - Date.now()) / 1000);
  if (oldHashTtl > 0)
    await redis
      .setex(`blacklist:${hash}`, oldHashTtl, JSON.stringify({ userId, role }))
      .catch(() => {});

  return {
    access_token: accessToken,
    refresh_token: newRefresh,
    expires_at: expiresAt,
    token_type: 'Bearer',
  };
};

// ── Logout ───────────────────────────────────────────────────────────────────

export const logoutUser = async ({ token, exp, refreshToken, sessionId, userId, role }) => {
  const ops = [];
  const accessHash = hashToken(token);
  const expMs = exp * 1000;
  if (expMs > Date.now()) ops.push(repo.addToBlacklist(accessHash, new Date(expMs)));
  ops.push(redis.setex(`blacklist:${accessHash}`, exp - Math.floor(Date.now() / 1000), '1'));
  if (sessionId) ops.push(repo.revokeSession(sessionId, 'MANUAL_LOGOUT'));
  if (refreshToken) {
    const refreshHash = hashToken(refreshToken);
    ops.push(repo.addToBlacklist(refreshHash, new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)));
  }
  await Promise.all(ops);
  if (sessionId) await redis.del(`session:${sessionId}`).catch(() => {});
  if (userId && role) await redis.del(`user:${role}:${userId}`).catch(() => {});
};

// ── Change Password ──────────────────────────────────────────────────────────

export const changePassword = async ({ userId, role, oldPassword, newPassword, ipAddress }) => {
  if (role === 'PARENT_USER')
    throw ApiError.badRequest('Password change not supported for parent accounts. Use OTP login.');

  let user, passwordHash;
  if (role === 'SUPER_ADMIN') {
    user = await repo.findSuperAdminById(userId);
    passwordHash = user?.password_hash;
  } else if (role === 'ADMIN') {
    user = await repo.findSchoolUserById(userId);
    passwordHash = user?.password_hash;
  } else throw ApiError.badRequest('Invalid user type');

  if (!user) throw ApiError.notFound('User not found');

  const isValid = await verifyPassword(oldPassword, passwordHash);
  if (!isValid) {
    await recordFailedAuth(ipAddress, userId, 'INVALID_OLD_PASSWORD');
    throw ApiError.unauthorized('Invalid current password');
  }

  const hashedPassword = await bcrypt.hash(newPassword, 12);
  if (role === 'SUPER_ADMIN') await repo.updateSuperAdminPassword(userId, hashedPassword);
  else if (role === 'ADMIN') await repo.updateSchoolUserPassword(userId, hashedPassword);

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

  return { message: 'Password changed successfully. Please login again.' };
};

// ── Change Phone ─────────────────────────────────────────────────────────────

export const initiatePhoneChange = async ({ userId, newPhone, ipAddress }) => {
  const phoneIndex = hashForLookup(newPhone);
  const existingUser = await repo.findParentByPhoneIndex(phoneIndex);
  if (existingUser) throw ApiError.conflict('Phone number already registered with another account');

  const phoneKey = `phone_change:${hashForLookup(newPhone)}`;
  const attempts = await redis.incr(phoneKey);
  if (attempts === 1) await redis.expire(phoneKey, 3600);
  if (attempts > 3)
    throw ApiError.tooManyRequests('Too many phone change attempts. Try after 1 hour.');

  const otp = generateOtp();
  const hashed = hashOtp(otp);
  const changeToken = crypto.randomBytes(32).toString('hex');

  await redis.setex(
    `phone_change:${changeToken}`,
    OTP_TTL_SECONDS,
    JSON.stringify({
      userId,
      newPhone,
      newPhoneIndex: phoneIndex,
      otpHash: hashed,
      attempts: 0,
      createdAt: Date.now(),
    })
  );
  await sendOtpNotification({
    phone: newPhone,
    otp,
    namespace: 'phone_change',
    expiryMinutes: OTP_TTL_SECONDS / 60,
  });

  return { changeToken, expiresIn: OTP_TTL_SECONDS };
};

export const verifyPhoneChange = async ({ changeToken, otp }) => {
  const changeDataRaw = await redis.get(`phone_change:${changeToken}`);
  if (!changeDataRaw) throw ApiError.badRequest('Phone change session expired or invalid');

  const changeData = JSON.parse(changeDataRaw);
  if (changeData.attempts >= OTP_MAX_ATTEMPTS) {
    await redis.del(`phone_change:${changeToken}`);
    throw ApiError.tooManyRequests('Too many attempts. Please start again.');
  }

  const inputHash = hashOtp(otp);
  const storedBuf = Buffer.from(changeData.otpHash, 'hex');
  const inputBuf = Buffer.from(inputHash, 'hex');
  const valid = storedBuf.length === inputBuf.length && crypto.timingSafeEqual(storedBuf, inputBuf);

  if (!valid) {
    changeData.attempts++;
    await redis.set(`phone_change:${changeToken}`, JSON.stringify(changeData), 'KEEPTTL');
    throw ApiError.unauthorized('Invalid OTP');
  }

  const parent = await repo.findParentWithDetails(changeData.userId);
  if (!parent) throw ApiError.notFound('User not found');

  const encryptedPhone = encryptField(changeData.newPhone);
  await repo.updateParentPhone(changeData.userId, encryptedPhone, changeData.newPhoneIndex);
  await repo.revokeAllUserSessions(changeData.userId, 'PARENT_USER', 'PHONE_CHANGED');
  await redis.del(`phone_change:${changeToken}`);

  return { message: 'Phone number changed successfully. Please login again.' };
};

// ── Device ───────────────────────────────────────────────────────────────────

async function upsertParentDevice({ parentId, deviceFingerprint, deviceInfo }) {
  if (!deviceFingerprint) return null;

  const existingDevice = await prisma.parentDevice.findFirst({
    where: { parent_id: parentId, device_fingerprint: deviceFingerprint },
  });

  if (existingDevice) {
    return prisma.parentDevice.update({
      where: { id: existingDevice.id },
      data: {
        is_active: true,
        logged_out_at: null,
        last_seen_at: new Date(),
        device_name: deviceInfo?.device_name || existingDevice.device_name,
        device_model: deviceInfo?.device_model || existingDevice.device_model,
        os_version: deviceInfo?.os_version || existingDevice.os_version,
        app_version: deviceInfo?.app_version || existingDevice.app_version,
        platform: deviceInfo?.platform || existingDevice.platform,
      },
    });
  }

  const newDevice = await prisma.parentDevice.create({
    data: {
      parent_id: parentId,
      device_fingerprint: deviceFingerprint,
      platform: deviceInfo?.platform || 'ANDROID',
      device_name: deviceInfo?.device_name || null,
      device_model: deviceInfo?.device_model || null,
      os_version: deviceInfo?.os_version || null,
      app_version: deviceInfo?.app_version || null,
      is_active: true,
      last_seen_at: new Date(),
    },
  });

  try {
    await sendNewDeviceAlert(parentId, 'PARENT_USER', {
      device: deviceInfo?.device_model || deviceInfo?.device_name || 'Unknown device',
      location: deviceInfo?.ip || 'Unknown location',
    });
  } catch (err) {
    logger.error({ err: err.message, parentId }, '[Auth] Failed to send new device alert');
  }

  return newDevice;
}
