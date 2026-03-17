import * as authService from "../../services/auth/auth.service.js";

import { ApiResponse } from "../../utils/response/ApiResponse.js";
import { asyncHandler } from "../../utils/response/asyncHandler.js";

import { extractIp } from "../../utils/network/extractIp.js";
import { parseUserAgentSummary } from "../../utils/network/userAgent.js";

/**
 * =============================================================================
 * SUPER ADMIN LOGIN
 * =============================================================================
 */

export const loginSuperAdminController = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const ipAddress = extractIp(req);
  const deviceInfo = parseUserAgentSummary(req);

  const result = await authService.loginSuperAdmin({
    email,
    password,
    ipAddress,
    deviceInfo,
  });

  return ApiResponse.ok(result, "Login successful").send(res);
});

/**
 * =============================================================================
 * SCHOOL USER LOGIN
 * =============================================================================
 */

export const loginSchoolUserController = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const ipAddress = extractIp(req);
  const deviceInfo = parseUserAgentSummary(req);

  const result = await authService.loginSchoolUser({
    email,
    password,
    ipAddress,
    deviceInfo,
  });

  return ApiResponse.ok(result, "Login successful").send(res);
});

/**
 * =============================================================================
 * SEND OTP
 * =============================================================================
 */

export const sendOtpController = asyncHandler(async (req, res) => {
  const { phone } = req.body;

  const result = await authService.sendOtp({ phone });

  return ApiResponse.ok(result, "OTP sent successfully").send(res);
});

/**
 * =============================================================================
 * VERIFY OTP
 * =============================================================================
 */

export const verifyOtpController = asyncHandler(async (req, res) => {
  const { phone, otp } = req.body;

  const ipAddress = extractIp(req);
  const deviceInfo = parseUserAgentSummary(req);

  const result = await authService.verifyOtp({
    phone,
    otp,
    ipAddress,
    deviceInfo,
  });

  return ApiResponse.ok(result, "Login successful").send(res);
});

/**
 * =============================================================================
 * REFRESH TOKEN
 * =============================================================================
 */

export const refreshTokenController = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;

  const ipAddress = extractIp(req);
  const deviceInfo = parseUserAgentSummary(req);

  const result = await authService.refreshTokens({
    refreshToken,
    ipAddress,
    deviceInfo,
  });

  return ApiResponse.ok(result, "Token refreshed").send(res);
});

/**
 * =============================================================================
 * LOGOUT
 * =============================================================================
 */

export const logoutController = asyncHandler(async (req, res) => {
  const token = req.token;
  const exp = req.tokenExp;
  const sessionId = req.sessionId;

  const { refreshToken } = req.body ?? {};

  await authService.logoutUser({
    token,
    exp,
    refreshToken,
    sessionId,
  });

  return ApiResponse.ok(null, "Logged out successfully").send(res);
});
