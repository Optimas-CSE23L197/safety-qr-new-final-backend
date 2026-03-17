// =============================================================================
// auth.routes.js — RESQID
// Authentication routes — super admin, school user, parent OTP flow
//
// FIX [#13]: validate() takes a Zod schema as the first argument, not an
// object. All routes were incorrectly calling validate({ body: schema })
// which passed a plain object where a Zod schema was expected, causing:
//   "TypeError: schema.safeParse is not a function"
// Fixed to validate(schema) — "body" is the default target so it need not
// be specified. Use validateAll({ body, params, query }) only when multiple
// targets must be validated simultaneously.
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
} from "./auth.validation.js";

import {
  loginSuperAdminController,
  loginSchoolUserController,
  sendOtpController,
  verifyOtpController,
  refreshTokenController,
  logoutController,
} from "./auth.controller.js";

const router = Router();

/**
 * ============================================================
 * SUPER ADMIN LOGIN
 * POST /api/auth/super-admin
 * ============================================================
 */
router.post(
  "/super-admin",
  authSlowDown,
  authLimiter,
  validate(emailPasswordValidation), // ✅ schema first, "body" is default
  loginSuperAdminController,
);

/**
 * ============================================================
 * SCHOOL USER LOGIN
 * POST /api/auth/school
 * ============================================================
 */
router.post(
  "/school",
  authSlowDown,
  authLimiter,
  validate(emailPasswordValidation), // ✅
  loginSchoolUserController,
);

/**
 * ============================================================
 * PARENT AUTH (OTP FLOW)
 * ============================================================
 */

/**
 * Step 1: Send OTP
 * POST /api/auth/send-otp
 */
router.post(
  "/send-otp",
  authLimiter,
  validate(sendOtpValidation), // ✅
  sendOtpController,
);

/**
 * Step 2: Verify OTP
 * POST /api/auth/verify-otp
 */
router.post(
  "/verify-otp",
  authLimiter,
  validate(verifyOtpValidation), // ✅
  verifyOtpController,
);

/**
 * ============================================================
 * REFRESH TOKEN
 * POST /api/auth/refresh
 * ============================================================
 */
router.post("/refresh", authLimiter, refreshTokenController);

/**
 * ============================================================
 * LOGOUT
 * POST /api/auth/logout
 * ============================================================
 */
router.post("/logout", authenticate, logoutController);

export default router;
