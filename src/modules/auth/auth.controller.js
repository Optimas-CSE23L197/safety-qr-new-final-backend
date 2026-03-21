import * as authService from "../../services/auth/auth.service.js";

import { ApiResponse } from "../../utils/response/ApiResponse.js";
import { asyncHandler } from "../../utils/response/asyncHandler.js";

import { extractIp } from "../../utils/network/extractIp.js";
import { parseUserAgentSummary } from "../../utils/network/userAgent.js";

// ─── Super Admin Login ────────────────────────────────────────────────────────

export const loginSuperAdminController = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const result = await authService.loginSuperAdmin({
    email,
    password,
    ipAddress: extractIp(req),
    deviceInfo: parseUserAgentSummary(req),
    userAgent: req.headers["user-agent"] ?? null, // FIX: needed for failed login audit
  });

  return ApiResponse.ok(result, "Login successful").send(res);
});

// ─── School User Login ────────────────────────────────────────────────────────

export const loginSchoolUserController = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const result = await authService.loginSchoolUser({
    email,
    password,
    ipAddress: extractIp(req),
    deviceInfo: parseUserAgentSummary(req),
    userAgent: req.headers["user-agent"] ?? null, // FIX: needed for failed login audit
  });

  return ApiResponse.ok(result, "Login successful").send(res);
});

// ─── Send OTP ─────────────────────────────────────────────────────────────────

export const sendOtpController = asyncHandler(async (req, res) => {
  const { phone } = req.body;

  const result = await authService.sendOtp({ phone });

  return ApiResponse.ok(result, "OTP sent successfully").send(res);
});

// ─── Verify OTP ───────────────────────────────────────────────────────────────

export const verifyOtpController = asyncHandler(async (req, res) => {
  const { phone, otp } = req.body;

  const result = await authService.verifyOtp({
    phone,
    otp,
    ipAddress: extractIp(req),
    deviceInfo: parseUserAgentSummary(req),
  });

  return ApiResponse.ok(result, "Login successful").send(res);
});

// ─── Refresh Token ────────────────────────────────────────────────────────────

export const refreshTokenController = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;

  const result = await authService.refreshTokens({
    refreshToken,
    ipAddress: extractIp(req),
    deviceInfo: parseUserAgentSummary(req),
  });

  return ApiResponse.ok(result, "Token refreshed").send(res);
});

// ─── Logout ───────────────────────────────────────────────────────────────────

export const logoutController = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body ?? {};

  await authService.logoutUser({
    token: req.token,
    exp: req.tokenExp,
    sessionId: req.sessionId,
    userId: req.userId, // FIX: required to invalidate user Redis cache on logout
    role: req.role, // FIX: required to invalidate user Redis cache on logout
    refreshToken,
  });

  return ApiResponse.ok(null, "Logged out successfully").send(res);
});
