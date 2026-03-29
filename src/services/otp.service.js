// =============================================================================
// otp.service.js — RESQID
// Secure OTP generation + verification with Redis
//
// Features:
// - Cryptographically secure OTP
// - Hashed OTP storage (never store raw)
// - Resend cooldown
// - Attempt limit protection
// - Constant-time comparison
// - Automatic cleanup
// =============================================================================

import crypto from 'crypto';
import { redis } from '#config/redis.js';
import { logger } from '#config/logger.js';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const OTP_TTL_SECONDS = 5 * 60; // 5 minutes
const OTP_LENGTH = 6;

const OTP_MAX_ATTEMPTS = 3;
const OTP_RESEND_COOLDOWN = 60;

// Redis keys
const otpKey = (phone, purpose) => `otp:${purpose}:${phone}`;
const attemptsKey = (phone, purpose) => `otp:attempts:${purpose}:${phone}`;
const cooldownKey = (phone, purpose) => `otp:cooldown:${purpose}:${phone}`;

// ─────────────────────────────────────────────────────────────────────────────
// GENERATE OTP
// ─────────────────────────────────────────────────────────────────────────────

export function generateOtp() {
  return crypto.randomInt(100000, 999999).toString();
}

export function hashOtp(otp) {
  return crypto.createHash('sha256').update(otp).digest('hex');
}

// ─────────────────────────────────────────────────────────────────────────────
// SEND OTP
// ─────────────────────────────────────────────────────────────────────────────

export async function sendOtp(phone) {
  // Check resend cooldown
  const cooldown = await redis.get(cooldownKey(phone, purpose));

  if (cooldown) {
    const ttl = await redis.ttl(cooldownKey(phone));
    throw new Error(`OTP_COOLDOWN:${ttl}`);
  }

  const otp = generateOtp();
  const hashed = hashOtp(otp);

  // Store hashed OTP
  await redis.setex(otpKey(phone, purpose), OTP_TTL_SECONDS, hashed);

  // Reset attempts
  await redis.del(attemptsKey(phone, purpose));

  // Set cooldown
  await redis.setex(cooldownKey(phone, purpose), OTP_RESEND_COOLDOWN, '1');

  // DEV logging only
  if (process.env.NODE_ENV !== 'production') {
    logger.debug({ phone, otp }, 'DEV OTP generated');
  }

  return {
    expiresInSeconds: OTP_TTL_SECONDS,
    ...(process.env.NODE_ENV !== 'production' && { devOtp: otp }),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// VERIFY OTP
// ─────────────────────────────────────────────────────────────────────────────

export async function verifyOtp(phone, otp) {
  const storedHash = await redis.get(otpKey(phone, purpose));

  if (!storedHash) {
    throw new Error('OTP_EXPIRED');
  }

  const attempts = parseInt((await redis.get(attemptsKey(phone, purpose))) ?? '0', 10);

  if (attempts >= OTP_MAX_ATTEMPTS) {
    await redis.del(otpKey(phone, purpose));
    await redis.del(attemptsKey(phone, purpose));
    throw new Error('OTP_MAX_ATTEMPTS');
  }

  const inputHash = hashOtp(otp);

  const isValid = crypto.timingSafeEqual(Buffer.from(inputHash), Buffer.from(storedHash));

  if (!isValid) {
    const newAttempts = await redis.incr(attemptsKey(phone));
    await redis.expire(attemptsKey(phone), OTP_TTL_SECONDS);
    throw new Error(`OTP_INVALID:${OTP_MAX_ATTEMPTS - newAttempts}`);
  }

  // Valid OTP → cleanup
  await redis.del(otpKey(phone, purpose));
  await redis.del(attemptsKey(phone, purpose));
  await redis.del(cooldownKey(phone, purpose));

  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// OPTIONAL UTILITY
// ─────────────────────────────────────────────────────────────────────────────

export async function clearOtp(phone, purpose = 'LOGIN') {
  await redis.del(otpKey(phone, purpose));
  await redis.del(attemptsKey(phone, purpose));
  await redis.del(cooldownKey(phone, purpose));
}
