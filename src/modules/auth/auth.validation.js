// =============================================================================
// src/modules/auth/validation.js — RESQID
// =============================================================================

import { z } from "zod";
import {
  isValidIndianPhone,
  isValidEmail,
  isValidOtp,
  zodRefine,
} from "../../utils/helpers/validator.js";

// ─── Email + Password (Super Admin + School User login) ───────────────────────

export const emailPasswordValidation = z.object({
  email: z.string().trim().toLowerCase().superRefine(zodRefine(isValidEmail)),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(100),
});

// ─── Parent Login: Send OTP ───────────────────────────────────────────────────

export const sendOtpValidation = z.object({
  phone: z.string().trim().superRefine(zodRefine(isValidIndianPhone)),
});

// ─── Parent Login: Verify OTP ─────────────────────────────────────────────────

export const verifyOtpValidation = z.object({
  phone: z.string().trim().superRefine(zodRefine(isValidIndianPhone)),
  otp: z.string().trim().superRefine(zodRefine(isValidOtp)),
});

// ─── Parent Registration: Step 1 ─────────────────────────────────────────────
// card_number: printed on physical card (e.g. RQ-TST-A1B2C3)

export const registerInitValidation = z.object({
  // auth_validation.js — registerInitValidation
  card_number: z
    .string()
    .trim()
    .length(16, "Card number must be 16 characters")
    .transform((v) => v.toUpperCase().replace(/[^A-Z0-9-]/g, "")),
  phone: z.string().trim().superRefine(zodRefine(isValidIndianPhone)),
});

// ─── Parent Registration: Step 2 ─────────────────────────────────────────────
// nonce must match the phone used in step 1 — prevents nonce theft

export const registerVerifyValidation = z.object({
  nonce: z.string().trim().min(10, "Invalid registration session"),
  otp: z.string().trim().superRefine(zodRefine(isValidOtp)),
  phone: z.string().trim().superRefine(zodRefine(isValidIndianPhone)),
});

// ─── Refresh Token ────────────────────────────────────────────────────────────

export const refreshTokenValidation = z.object({
  refreshToken: z.string().min(20, "Invalid refresh token"),
});

// ─── Logout ───────────────────────────────────────────────────────────────────

export const logoutValidation = z.object({
  refreshToken: z.string().optional(),
});
