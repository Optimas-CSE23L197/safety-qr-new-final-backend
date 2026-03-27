// =============================================================================
// src/modules/auth/controller.js — RESQID (FIXED)
// =============================================================================

import * as authService from './auth.service.js';
import { ApiResponse } from '#utils/response/ApiResponse.js';
import { asyncHandler } from '#utils/response/asyncHandler.js';
import { extractIp } from '#utils/network/extractIp.js';
import { parseUserAgentSummary } from '#utils/network/userAgent.js';
import { ApiError } from '#utils/response/ApiError.js';
import { setAuthCookies, clearAuthCookies } from '#config/cookie.js';

// ─── Super Admin Login ────────────────────────────────────────────────────────
export const loginSuperAdminController = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const result = await authService.loginSuperAdmin({
    email,
    password,
    ipAddress: extractIp(req),
    deviceInfo: parseUserAgentSummary(req),
    userAgent: req.headers['user-agent'] ?? null,
  });

  setAuthCookies(res, result.access_token, result.refresh_token);

  // ✅ CORRECT: pass res as first argument
  return ApiResponse.ok(res, { user: result.user }, 'Login successful');
});

// ─── School User Login ────────────────────────────────────────────────────────
export const loginSchoolUserController = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const result = await authService.loginSchoolUser({
    email,
    password,
    ipAddress: extractIp(req),
    deviceInfo: parseUserAgentSummary(req),
    userAgent: req.headers['user-agent'] ?? null,
  });

  setAuthCookies(res, result.access_token, result.refresh_token);

  return ApiResponse.ok(res, { user: result.user }, 'Login successful');
});

// ─── Parent Login: Send OTP ───────────────────────────────────────────────────
export const sendOtpController = asyncHandler(async (req, res) => {
  const { phone } = req.body;
  const result = await authService.sendOtp({
    phone,
    ipAddress: extractIp(req),
    deviceId: req.headers['x-device-id'],
  });
  return ApiResponse.ok(res, result, 'OTP sent successfully');
});

// ─── Parent Login: Verify OTP ─────────────────────────────────────────────────
export const verifyOtpController = asyncHandler(async (req, res) => {
  const { phone, otp } = req.body;

  try {
    const result = await authService.verifyOtp({
      phone,
      otp,
      ipAddress: extractIp(req),
      deviceInfo: {
        ...parseUserAgentSummary(req),
        userAgent: req.headers['user-agent'],
        language: req.headers['accept-language'],
      },
    });
    return ApiResponse.ok(res, result, 'Login successful');
  } catch (error) {
    if (error.code === 'NOT_FOUND' || error.message.includes('Account not found')) {
      return res.status(404).json({
        success: false,
        code: 'USER_NOT_FOUND',
        message: 'Account not found. Please register using your RESQID card.',
        redirectTo: '/register',
      });
    }
    throw error;
  }
});

// ─── Parent Registration: Step 1 — Init ──────────────────────────────────────
export const registerInitController = asyncHandler(async (req, res) => {
  const { card_number, phone } = req.body;
  const result = await authService.registerInit({
    card_number,
    phone,
    ipAddress: extractIp(req),
  });
  return ApiResponse.ok(res, result, 'OTP sent to your mobile number');
});

// ─── Parent Registration: Step 2 — Verify ────────────────────────────────────
export const registerVerifyController = asyncHandler(async (req, res) => {
  const { nonce, otp, phone } = req.body;
  const result = await authService.registerVerify({
    nonce,
    otp,
    phone,
    ipAddress: extractIp(req),
    deviceInfo: {
      ...parseUserAgentSummary(req),
      userAgent: req.headers['user-agent'],
    },
  });
  return ApiResponse.ok(res, result, 'Registration successful');
});

// ─── Refresh Token ────────────────────────────────────────────────────────────
export const refreshTokenController = asyncHandler(async (req, res) => {
  const refreshToken = req.cookies?.refreshToken;

  if (!refreshToken) {
    throw ApiError.unauthorized('Missing refresh token');
  }

  const result = await authService.refreshTokens({
    refreshToken,
    ipAddress: extractIp(req),
    deviceInfo: parseUserAgentSummary(req),
  });

  setAuthCookies(res, result.access_token, result.refresh_token);

  return ApiResponse.ok(res, null, 'Token refreshed');
});

// ─── Logout ───────────────────────────────────────────────────────────────────
export const logoutController = asyncHandler(async (req, res) => {
  const refreshToken = req.cookies?.refreshToken;

  await authService.logoutUser({
    token: req.token,
    exp: req.tokenExp,
    sessionId: req.sessionId,
    userId: req.userId,
    role: req.role,
    refreshToken,
  });

  clearAuthCookies(res);

  return ApiResponse.ok(res, null, 'Logged out successfully');
});

// ─── Change Password Controller ───────────────────────────────────────────────
export const changePasswordController = asyncHandler(async (req, res) => {
  const { oldPassword, newPassword } = req.body;

  const result = await authService.changePassword({
    userId: req.userId,
    role: req.role,
    oldPassword,
    newPassword,
    ipAddress: extractIp(req),
  });

  clearAuthCookies(res);

  return ApiResponse.ok(res, result, 'Password changed successfully. Please login again.');
});
