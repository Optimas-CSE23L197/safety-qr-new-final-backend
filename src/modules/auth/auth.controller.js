// =============================================================================
// src/modules/auth/controller.js — RESQID (FIXED)
// =============================================================================

import * as authService from './auth.service.js';
import { ApiResponse } from '#shared/response/ApiResponse.js';
import { asyncHandler } from '#shared/response/asyncHandler.js';
import { extractIp } from '#shared/network/extractIp.js';
import { parseUserAgentSummary } from '#shared/network/userAgent.js';
import { ApiError } from '#shared/response/ApiError.js';
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

// Global error handler will catch it. REPLACE with:
export const verifyOtpController = asyncHandler(async (req, res) => {
  const { phone, otp } = req.body;
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

  // ✅ response first, THEN clear cookies
  const response = ApiResponse.ok(
    res,
    result,
    'Password changed successfully. Please login again.'
  );
  clearAuthCookies(res);
  return response;
});
