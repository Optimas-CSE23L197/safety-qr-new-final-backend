// =============================================================================
// src/modules/auth/controller.js — RESQID
// =============================================================================

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
    userAgent: req.headers["user-agent"] ?? null,
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
    userAgent: req.headers["user-agent"] ?? null,
  });
  return ApiResponse.ok(result, "Login successful").send(res);
});

// ─── Parent Login: Send OTP ───────────────────────────────────────────────────

export const sendOtpController = asyncHandler(async (req, res) => {
  const { phone } = req.body;
  const result = await authService.sendOtp({ phone });
  return ApiResponse.ok(result, "OTP sent successfully").send(res);
});

// ─── Parent Login: Verify OTP ─────────────────────────────────────────────────

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

// ─── Parent Registration: Step 1 — Init ──────────────────────────────────────
// Validates card number → sends OTP → returns nonce

export const registerInitController = asyncHandler(async (req, res) => {
  const { card_number, phone } = req.body;
  const result = await authService.registerInit({ card_number, phone });
  return ApiResponse.ok(result, "OTP sent to your mobile number").send(res);
});

// ─── Parent Registration: Step 2 — Verify ────────────────────────────────────
// Verifies nonce + OTP → creates parent → links to student → issues tokens

export const registerVerifyController = asyncHandler(async (req, res) => {
  const { nonce, otp, phone } = req.body;
  const result = await authService.registerVerify({
    nonce,
    otp,
    phone,
    ipAddress: extractIp(req),
    deviceInfo: parseUserAgentSummary(req),
  });
  return ApiResponse.ok(result, "Registration successful").send(res);
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
    userId: req.userId,
    role: req.role,
    refreshToken,
  });
  return ApiResponse.ok(null, "Logged out successfully").send(res);
});
