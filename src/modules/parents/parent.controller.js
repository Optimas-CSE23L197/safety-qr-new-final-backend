// =============================================================================
// modules/parents/controllers/ — RESQID
// All parent controllers in one file for clarity.
// Each is a thin HTTP wrapper — all logic in parent.service.js
// =============================================================================

import * as service from './parent.service.js';
import { requireOwnParent } from './parent.validation.js';
import { logger } from '#config/logger.js';
import { extractIp } from '#shared/network/extractIp.js'; // ✅ ADD THIS

// For sendSms - you need to implement or import
// import { sendSms } from '#services/communication/sms.service.js';

// Temporary placeholder for sendSms (implement actual SMS service)
const sendSms = async (phone, message) => {
  logger.info({ phone, message }, '[DEV] SMS would be sent');
  // TODO: Implement actual SMS via MSG91
};

// ─── Error helper ─────────────────────────────────────────────────────────────
function handleError(res, err, context) {
  if (err.statusCode) {
    return res
      .status(err.statusCode)
      .json({ success: false, code: err.code, message: err.message });
  }
  logger.error({ ...context, err: err.message }, `${context.fn} failed`);
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

  try {
    const result = await service.updateVisibility(parentId, req.validatedBody);
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
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

// =============================================================================
// modules/parents/parent.controller.js — RESQID (ENHANCED)
// Add these new controllers
// =============================================================================

// ... existing imports ...

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

    // Check if phone already exists
    const phoneIndex = hashForLookup(new_phone);
    const existing = await prisma.parentUser.findUnique({
      where: { phone_index: phoneIndex },
    });

    if (existing && existing.id !== parentId) {
      return res.status(409).json({
        success: false,
        code: 'PHONE_ALREADY_EXISTS',
        message: 'This phone number is already registered',
      });
    }

    const otp = generateOtp();
    const hashed = hashOtp(otp);

    await redis.setex(
      `otp:phone_change:${new_phone}`,
      300, // 5 minutes
      JSON.stringify({ hash: hashed, phone: new_phone, parentId })
    );

    // Send SMS via MSG91
    await sendSms(new_phone, `Your RESQID verification code is ${otp}. Valid for 5 minutes.`);

    return res.status(200).json({
      success: true,
      message: 'OTP sent successfully',
      expiresIn: 300,
    });
  } catch (err) {
    return handleError(res, err, { fn: 'sendPhoneChangeOtp', parentId });
  }
}

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
