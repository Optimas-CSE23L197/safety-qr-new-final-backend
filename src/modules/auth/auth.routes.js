// =============================================================================
// src/modules/auth/routes.js — RESQID (FIXED)
// Mounted at /api/auth
// =============================================================================

import { Router } from 'express';

import { validate } from '#middleware/validate.middleware.js';
import { authenticate } from '#middleware/auth/auth.middleware.js';
import { authLimiter } from '#middleware/security/rateLimit.middleware.js';
import { authSlowDown } from '#middleware/security/slowDown.middleware.js';

import {
  emailPasswordValidation,
  sendOtpValidation,
  verifyOtpValidation,
  registerInitValidation,
  registerVerifyValidation,
  changePasswordValidation,
  refreshTokenValidation,
} from './auth.validation.js';

import {
  loginSuperAdminController,
  loginSchoolUserController,
  sendOtpController,
  verifyOtpController,
  registerInitController,
  registerVerifyController,
  refreshTokenController,
  logoutController,
  changePasswordController,
} from './auth.controller.js';

const router = Router();

// ── Super Admin Login ─────────────────────────────────────────────────────────
router.post(
  '/super-admin',
  authSlowDown,
  authLimiter,
  validate(emailPasswordValidation),
  loginSuperAdminController
);

// ── School User Login ─────────────────────────────────────────────────────────
router.post(
  '/school',
  authSlowDown,
  authLimiter,
  validate(emailPasswordValidation),
  loginSchoolUserController
);

// ── Parent Login: Send OTP ────────────────────────────────────────────────────
router.post('/send-otp', authSlowDown, authLimiter, validate(sendOtpValidation), sendOtpController);

// ── Parent Login: Verify OTP ──────────────────────────────────────────────────
router.post(
  '/verify-otp',
  authSlowDown,
  authLimiter,
  validate(verifyOtpValidation),
  verifyOtpController
);

// ── Parent Registration: Step 1 — validate card + send OTP + issue nonce ─────
router.post(
  '/register/init',
  authSlowDown, // ✅ ADDED slow down for registration
  authLimiter,
  validate(registerInitValidation),
  registerInitController
);

// ── Parent Registration: Step 2 — verify nonce + OTP → issue tokens ──────────
router.post(
  '/register/verify',
  authSlowDown, // ✅ ADDED slow down for registration
  authLimiter,
  validate(registerVerifyValidation),
  registerVerifyController
);

// ── Change Password ───────────────────────────────────────────────────────────
router.post(
  '/change-password',
  authLimiter,
  authenticate,
  validate(changePasswordValidation),
  changePasswordController
);

// ── Refresh Token ─────────────────────────────────────────────────────────────
router.post('/refresh', authSlowDown, authLimiter, refreshTokenController);

// ── Logout ────────────────────────────────────────────────────────────────────
router.post('/logout', authenticate, logoutController);

export default router;
