// =============================================================================
// src/modules/auth/controller.js — RESQID (FIXED COOKIE FLOW)
// =============================================================================

import * as authService from "../../services/auth/auth.service.js";
import { ApiResponse } from "../../utils/response/ApiResponse.js";
import { asyncHandler } from "../../utils/response/asyncHandler.js";
import { extractIp } from "../../utils/network/extractIp.js";
import { parseUserAgentSummary } from "../../utils/network/userAgent.js";
import { ApiError } from "../../utils/response/ApiError.js";
import { setAuthCookies, clearAuthCookies } from "../../config/cookie.js";

// ─── Super Admin Login ────────────────────────────────────────────────────────
export const loginSuperAdminController = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const result = await authService.loginSuperAdmin({
    email,
    password,
    ipAddress: extractIp(req),
    deviceInfo: parseUserAgentSummary(req),
    userAgent: req.headers["user-agent"] ?? null,
  });

  setAuthCookies(res, result.access_token, result.refresh_token);

  return ApiResponse.ok({ user: result.user }, "Login successful").send(res);
});

// ─── School User Login ────────────────────────────────────────────────────────
export const loginSchoolUserController = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const result = await authService.loginSchoolUser({
    email,
    password,
    ipAddress: extractIp(req),
    deviceInfo: parseUserAgentSummary(req),
    userAgent: req.headers["user-agent"] ?? null,
  });

  setAuthCookies(res, result.access_token, result.refresh_token);

  return ApiResponse.ok({ user: result.user }, "Login successful").send(res);
});

// ─── Parent Login: Send OTP ───────────────────────────────────────────────────
export const sendOtpController = asyncHandler(async (req, res) => {
  const { phone } = req.body;
  const result = await authService.sendOtp({
    phone,
    ipAddress: extractIp(req),
    deviceId: req.headers["x-device-id"],
  });
  return ApiResponse.ok(result, "OTP sent successfully").send(res);
});

// ─── Parent Login: Verify OTP ─────────────────────────────────────────────────
export const verifyOtpController = asyncHandler(async (req, res) => {
  const { phone, otp } = req.body;
  const result = await authService.verifyOtp({
    phone,
    otp,
    ipAddress: extractIp(req),
    deviceInfo: {
      ...parseUserAgentSummary(req),
      userAgent: req.headers["user-agent"],
      language: req.headers["accept-language"],
    },
  });
  return ApiResponse.ok(result, "Login successful").send(res);
});

// ─── Parent Registration: Step 1 — Init ──────────────────────────────────────
export const registerInitController = asyncHandler(async (req, res) => {
  const { card_number, phone } = req.body;
  const result = await authService.registerInit({
    card_number,
    phone,
    ipAddress: extractIp(req),
  });
  return ApiResponse.ok(result, "OTP sent to your mobile number").send(res);
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
      userAgent: req.headers["user-agent"],
    },
  });
  return ApiResponse.ok(result, "Registration successful").send(res);
});

// ─── Refresh Token ────────────────────────────────────────────────────────────
export const refreshTokenController = asyncHandler(async (req, res) => {
  const refreshToken = req.cookies?.refreshToken;

  if (!refreshToken) {
    throw ApiError.unauthorized("Missing refresh token");
  }

  const result = await authService.refreshTokens({
    refreshToken,
    ipAddress: extractIp(req),
    deviceInfo: parseUserAgentSummary(req),
  });

  setAuthCookies(res, result.access_token, result.refresh_token);

  return ApiResponse.ok(null, "Token refreshed").send(res);
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

  return ApiResponse.ok(null, "Logged out successfully").send(res);
});

// ✅ ADD THIS - Change Password Controller
export const changePasswordController = asyncHandler(async (req, res) => {
  const { oldPassword, newPassword } = req.body;

  const result = await authService.changePassword({
    userId: req.userId,
    role: req.role,
    oldPassword,
    newPassword,
    ipAddress: extractIp(req),
  });

  // Clear cookies after password change (force re-login)
  clearAuthCookies(res);

  return ApiResponse.ok(
    result,
    "Password changed successfully. Please login again.",
  ).send(res);
});
