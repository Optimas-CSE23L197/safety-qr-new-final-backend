// =============================================================================
// src/modules/auth/routes.js — RESQID
// Mounted at /api/auth
// =============================================================================

import { Router } from "express";

import { validate } from "../../middleware/validate.middleware.js";
import { authenticate } from "../../middleware/auth.middleware.js";
import { authLimiter } from "../../middleware/rateLimit.middleware.js";
import { authSlowDown } from "../../middleware/slowDown.middleware.js";

import {
  emailPasswordValidation,
  sendOtpValidation,
  verifyOtpValidation,
  registerInitValidation,
  registerVerifyValidation,
} from "./auth.validation.js";

import {
  loginSuperAdminController,
  loginSchoolUserController,
  sendOtpController,
  verifyOtpController,
  registerInitController,
  registerVerifyController,
  refreshTokenController,
  logoutController,
} from "./auth.controller.js";

const router = Router();

// ── Super Admin Login ─────────────────────────────────────────────────────────
router.post(
  "/super-admin",
  authSlowDown,
  authLimiter,
  validate(emailPasswordValidation),
  loginSuperAdminController,
);

// ── School User Login ─────────────────────────────────────────────────────────
router.post(
  "/school",
  authSlowDown,
  authLimiter,
  validate(emailPasswordValidation),
  loginSchoolUserController,
);

// ── Parent Login: Send OTP ────────────────────────────────────────────────────
router.post(
  "/send-otp",
  authLimiter,
  validate(sendOtpValidation),
  sendOtpController,
);

// ── Parent Login: Verify OTP ──────────────────────────────────────────────────
router.post(
  "/verify-otp",
  authLimiter,
  validate(verifyOtpValidation),
  verifyOtpController,
);

// ── Parent Registration: Step 1 — validate card + send OTP + issue nonce ─────
router.post(
  "/register/init",
  authLimiter,
  validate(registerInitValidation),
  registerInitController,
);

// ── Parent Registration: Step 2 — verify nonce + OTP → issue tokens ──────────
router.post(
  "/register/verify",
  authLimiter,
  validate(registerVerifyValidation),
  registerVerifyController,
);

// ── Refresh Token ─────────────────────────────────────────────────────────────
router.post("/refresh", authLimiter, refreshTokenController);

// ── Logout ────────────────────────────────────────────────────────────────────
router.post("/logout", authenticate, logoutController);

export default router;
