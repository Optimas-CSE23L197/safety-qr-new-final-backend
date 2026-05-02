// =============================================================================
// modules/parents/controllers/parent.controller.js — RESQID (FULLY FIXED)
// All parent controllers in one file for clarity.
// Each is a thin HTTP wrapper — all logic in parent.service.js
// =============================================================================

import * as service from './parent.service.js';
import { requireOwnParent } from './parent.validation.js';
import { logger } from '#config/logger.js';
import { extractIp } from '#shared/network/extractIp.js';
import { hashForLookup } from '#shared/security/encryption.js';
import { generateOtp, hashOtp } from '#services/otp.service.js';
import { redis } from '#config/redis.js';
import { prisma } from '#config/prisma.js';
import * as uploadService from '#services/upload.service.js';
import { asyncHandler } from '#shared/response/asyncHandler.js';
// import { sendSms } from '#integrations/sms/sms.service.js';

// ─── Error helper ─────────────────────────────────────────────────────────────
function handleError(res, err, context) {
  if (err.statusCode) {
    return res.status(err.statusCode).json({
      success: false,
      code: err.code,
      message: err.message,
    });
  }
  // REPLACE logger with this temporarily
  console.error('=== 500 ERROR ===');
  console.error('context:', context);
  console.error('message:', err.message);
  console.error('stack:', err.stack);
  console.error('full err:', err);
  return res.status(500).json({
    success: false,
    code: 'INTERNAL_ERROR',
    message: 'Something went wrong',
  });
}

// ─── GET /me ──────────────────────────────────────────────────────────────────
export async function getMe(req, res) {
  const parentId = requireOwnParent(req, res);
  if (!parentId) return;

  try {
    const data = await service.getParentHomeData(parentId);
    if (!data)
      return res.status(404).json({
        success: false,
        code: 'NOT_FOUND',
        message: 'Account not found',
      });
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return handleError(res, err, { fn: 'getMe', parentId });
  }
}

// ─── GET /me/scans ────────────────────────────────────────────────────────────
export async function getScanHistory(req, res) {
  const parentId = requireOwnParent(req, res);
  if (!parentId) return;

  try {
    const result = await service.getScanHistory(parentId, req.validatedQuery);
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    return handleError(res, err, { fn: 'getScanHistory', parentId });
  }
}

// ─── PATCH /me/profile ────────────────────────────────────────────────────────
export async function updateProfile(req, res) {
  const parentId = requireOwnParent(req, res);
  if (!parentId) return;

  try {
    const result = await service.updateProfile(parentId, req.validatedBody);
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    return handleError(res, err, { fn: 'updateProfile', parentId });
  }
}

// ─── PATCH /me/visibility ─────────────────────────────────────────────────────
export async function updateVisibility(req, res) {
  const parentId = requireOwnParent(req, res);
  if (!parentId) return;

  console.log('[updateVisibility] req.validatedBody:', req.validatedBody);

  try {
    const result = await service.updateVisibility(parentId, req.validatedBody);
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    console.error('[updateVisibility] error:', err);
    return handleError(res, err, { fn: 'updateVisibility', parentId });
  }
}

// ─── PATCH /me/notifications ──────────────────────────────────────────────────
export async function updateNotifications(req, res) {
  const parentId = requireOwnParent(req, res);
  if (!parentId) return;

  try {
    const result = await service.updateNotifications(parentId, req.validatedBody);
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    return handleError(res, err, { fn: 'updateNotifications', parentId });
  }
}

// ─── PATCH /me/location-consent ───────────────────────────────────────────────
export async function updateLocationConsent(req, res) {
  const parentId = requireOwnParent(req, res);
  if (!parentId) return;

  try {
    const result = await service.updateLocationConsent(parentId, req.validatedBody);
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    return handleError(res, err, { fn: 'updateLocationConsent', parentId });
  }
}

// ─── POST /me/lock-card ───────────────────────────────────────────────────────
export async function lockCard(req, res) {
  const parentId = requireOwnParent(req, res);
  if (!parentId) return;

  try {
    const result = await service.lockCard(parentId, req.validatedBody);
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    return handleError(res, err, { fn: 'lockCard', parentId });
  }
}

// ─── POST /me/request-replace ─────────────────────────────────────────────────
export async function requestReplace(req, res) {
  const parentId = requireOwnParent(req, res);
  if (!parentId) return;

  try {
    const result = await service.requestCardReplacement(parentId, req.validatedBody);
    return res.status(201).json({ success: true, data: result });
  } catch (err) {
    return handleError(res, err, { fn: 'requestReplace', parentId });
  }
}

// ─── DELETE /me ───────────────────────────────────────────────────────────────
export async function deleteAccount(req, res) {
  const parentId = requireOwnParent(req, res);
  if (!parentId) return;

  try {
    await service.deleteAccount(parentId);
    return res.status(200).json({ success: true, message: 'Account deleted' });
  } catch (err) {
    return handleError(res, err, { fn: 'deleteAccount', parentId });
  }
}

// ─── GET /me/location-history ─────────────────────────────────────────────────
export async function getLocationHistory(req, res) {
  const parentId = requireOwnParent(req, res);
  if (!parentId) return;

  try {
    const result = await service.getLocationHistory(parentId, req.validatedQuery);
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    return handleError(res, err, { fn: 'getLocationHistory', parentId });
  }
}

// ─── GET /me/anomalies ───────────────────────────────────────────────────────
export async function getAnomalies(req, res) {
  const parentId = requireOwnParent(req, res);
  if (!parentId) return;

  try {
    const result = await service.getAnomalies(parentId, req.validatedQuery);
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    return handleError(res, err, { fn: 'getAnomalies', parentId });
  }
}

// ─── GET /me/cards ───────────────────────────────────────────────────────────
export async function getCards(req, res) {
  const parentId = requireOwnParent(req, res);
  if (!parentId) return;

  try {
    const result = await service.getCards(parentId);
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    return handleError(res, err, { fn: 'getCards', parentId });
  }
}

// ─── POST /me/request-renewal ─────────────────────────────────────────────────
export async function requestRenewal(req, res) {
  const parentId = requireOwnParent(req, res);
  if (!parentId) return;

  try {
    const result = await service.requestRenewal(parentId, req.validatedBody);
    return res.status(201).json({ success: true, data: result });
  } catch (err) {
    return handleError(res, err, { fn: 'requestRenewal', parentId });
  }
}

// ─── POST /me/change-phone ───────────────────────────────────────────────────
export async function changePhone(req, res) {
  const parentId = requireOwnParent(req, res);
  if (!parentId) return;

  try {
    const { new_phone, otp } = req.validatedBody;
    const result = await service.changePhone(parentId, new_phone, otp, extractIp(req));
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    return handleError(res, err, { fn: 'changePhone', parentId });
  }
}

// ─── POST /me/send-phone-otp ─────────────────────────────────────────────────
export async function sendPhoneChangeOtp(req, res) {
  const parentId = requireOwnParent(req, res);
  if (!parentId) return;

  try {
    const { new_phone } = req.validatedBody;

    // Check if phone already belongs to another active parent
    const phoneIndex = hashForLookup(new_phone);
    const existing = await prisma.parentUser.findFirst({
      where: {
        phone_index: phoneIndex,
        id: { not: parentId },
        status: 'ACTIVE',
      },
    });

    if (existing) {
      return res.status(409).json({
        success: false,
        code: 'PHONE_ALREADY_EXISTS',
        message: 'This phone number is already registered with another account',
      });
    }

    // Rate limit by phone number
    const rateKey = `phone_change:rate:${new_phone}`;
    const rateAttempts = await redis.incr(rateKey);
    if (rateAttempts === 1) await redis.expire(rateKey, 3600);
    if (rateAttempts > 3) {
      return res.status(429).json({
        success: false,
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many OTP requests. Try after 1 hour.',
      });
    }

    const otp = generateOtp();
    console.log('[DEV PHONE CHANGE OTP]:', otp);
    const hashed = hashOtp(otp);

    await redis.setex(
      `otp:phone_change:${new_phone}`,
      300, // 5 minutes
      JSON.stringify({ hash: hashed, phone: new_phone, parentId })
    );

    // Send SMS via MSG91
    // await sendSms(new_phone, `Your RESQID verification code is ${otp}. Valid for 5 minutes.`);

    return res.status(200).json({
      success: true,
      message: 'OTP sent successfully',
      expiresIn: 300,
    });
  } catch (err) {
    return handleError(res, err, { fn: 'sendPhoneChangeOtp', parentId });
  }
}

// ─── POST /me/device-token ───────────────────────────────────────────────────
export async function registerDeviceToken(req, res) {
  const parentId = requireOwnParent(req, res);
  if (!parentId) return;

  try {
    const result = await service.registerDeviceToken(parentId, req.validatedBody);
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    return handleError(res, err, { fn: 'registerDeviceToken', parentId });
  }
}

// =============================================================================
// MULTI-CHILD SUPPORT — NEW CONTROLLERS
// =============================================================================

// ─── GET /me/children ─────────────────────────────────────────────────────────
// Lightweight list of all children for the switcher UI
export async function getChildrenList(req, res) {
  const parentId = requireOwnParent(req, res);
  if (!parentId) return;

  try {
    const result = await service.getChildrenList(parentId);
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    return handleError(res, err, { fn: 'getChildrenList', parentId });
  }
}

// ─── POST /me/link-card ───────────────────────────────────────────────────────
// add a new child
export async function linkCard(req, res) {
  const parentId = requireOwnParent(req, res);
  if (!parentId) return;

  try {
    const { card_number } = req.validatedBody; // removed phone
    const result = await service.linkCard({
      parentId,
      cardNumber: card_number,
      ipAddress: extractIp(req),
    });
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    return handleError(res, err, { fn: 'linkCard', parentId });
  }
}

// ─── PATCH /me/active-student ─────────────────────────────────────────────────
// Switch the active student for this parent
export async function setActiveStudent(req, res) {
  const parentId = requireOwnParent(req, res);
  if (!parentId) return;

  try {
    const { student_id } = req.validatedBody;
    const result = await service.setActiveStudent(parentId, student_id);
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    return handleError(res, err, { fn: 'setActiveStudent', parentId });
  }
}

// ─── POST /me/unlink-child/init ───────────────────────────────────────────────
export async function unlinkChildInit(req, res) {
  const parentId = requireOwnParent(req, res);
  if (!parentId) return;

  try {
    console.log('[unlinkChildInit] Starting for parent:', parentId);
    const { student_id } = req.validatedBody;
    console.log('[unlinkChildInit] Student ID:', student_id);
    const result = await service.unlinkChildInit({
      parentId,
      studentId: student_id,
      ipAddress: extractIp(req),
    });
    console.log('[unlinkChildInit] Success:', result);
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    console.error('[unlinkChildInit] ERROR:', err);
    console.error('[unlinkChildInit] Stack:', err.stack);
    return handleError(res, err, { fn: 'unlinkChildInit', parentId });
  }
}

// ─── POST /me/unlink-child/verify ─────────────────────────────────────────────
export async function unlinkChildVerify(req, res) {
  const parentId = requireOwnParent(req, res);
  if (!parentId) return;

  try {
    const { student_id, otp, nonce } = req.validatedBody;
    const result = await service.unlinkChildVerify({
      parentId,
      studentId: student_id,
      otp,
      nonce,
      ipAddress: extractIp(req),
    });
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    return handleError(res, err, { fn: 'unlinkChildVerify', parentId });
  }
}

// ─── POST /me/students/:studentId/photo/upload-url ──────────────────────────
export async function generateStudentPhotoUploadUrl(req, res) {
  const parentId = requireOwnParent(req, res);
  if (!parentId) return;

  try {
    const { studentId } = req.params;
    const { contentType, fileSize } = req.validatedBody;

    const result = await uploadService.generateStudentPhotoUploadUrl(
      parentId,
      studentId,
      contentType,
      fileSize
    );

    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    return handleError(res, err, { fn: 'generateStudentPhotoUploadUrl', parentId });
  }
}

// ─── POST /me/students/:studentId/photo/confirm ─────────────────────────────
export async function confirmStudentPhotoUpload(req, res) {
  const parentId = requireOwnParent(req, res);
  if (!parentId) return;

  try {
    const { studentId } = req.params;
    const { key, nonce } = req.validatedBody;

    const result = await uploadService.confirmStudentPhotoUpload(parentId, studentId, key, nonce);

    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    return handleError(res, err, { fn: 'confirmStudentPhotoUpload', parentId });
  }
}

// ─── POST /me/avatar/upload-url ─────────────────────────────────────────────
export async function generateAvatarUploadUrl(req, res) {
  const parentId = requireOwnParent(req, res);
  if (!parentId) return;

  try {
    const { contentType, fileSize } = req.validatedBody;

    const result = await uploadService.generateParentAvatarUploadUrl(
      parentId,
      contentType,
      fileSize
    );

    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    return handleError(res, err, { fn: 'generateAvatarUploadUrl', parentId });
  }
}

// ─── POST /me/avatar/confirm ────────────────────────────────────────────────
export async function confirmAvatarUpload(req, res) {
  const parentId = requireOwnParent(req, res);
  if (!parentId) return;

  try {
    const { key, nonce } = req.validatedBody;

    const result = await uploadService.confirmParentAvatarUpload(parentId, key, nonce);

    // Update parent avatar_url in database
    await service.updateParentAvatar(parentId, result.avatarUrl);

    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    return handleError(res, err, { fn: 'confirmAvatarUpload', parentId });
  }
}

// ─── PATCH /me/student/:studentId/basic ─────────────────────────────────────
export async function updateStudentBasic(req, res) {
  const parentId = requireOwnParent(req, res);
  if (!parentId) return;

  try {
    const { studentId } = req.params;
    const result = await service.updateStudentBasicInfo(parentId, studentId, req.validatedBody);
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    return handleError(res, err, { fn: 'updateStudentBasic', parentId });
  }
}

// ─── PATCH /me/profile ──────────────────────────────────────────────────────
export async function updateParentProfile(req, res) {
  const parentId = requireOwnParent(req, res);
  if (!parentId) return;

  try {
    const result = await service.updateParentName(parentId, req.validatedBody.name);
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    return handleError(res, err, { fn: 'updateParentProfile', parentId });
  }
}
// email verification
export const sendEmailVerificationOtp = asyncHandler(async (req, res) => {
  const parentId = req.user.id;
  const { email } = req.validatedBody;
  const result = await service.sendEmailVerificationOtp(parentId, email);
  return res.status(200).json({ success: true, data: result });
});

export const verifyEmail = asyncHandler(async (req, res) => {
  const parentId = req.user.id;
  const { email, otp } = req.validatedBody;
  const result = await service.verifyEmail(parentId, email, otp);
  return res.status(200).json({ success: true, data: result });
});

// email change - THIS IS WHAT YOU NEED TO ADD
export const sendEmailChangeOtp = asyncHandler(async (req, res) => {
  const parentId = req.user.id;
  const { email } = req.validatedBody;
  const result = await service.sendEmailChangeOtp(parentId, email);
  return res.status(200).json({ success: true, data: result });
});

export const verifyEmailChange = asyncHandler(async (req, res) => {
  const parentId = req.user.id;
  const { email, otp } = req.validatedBody;
  const result = await service.verifyEmailChange(parentId, email, otp);
  return res.status(200).json({ success: true, data: result });
});
