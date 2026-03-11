import { z } from "zod";

import {
  isValidIndianPhone,
  isValidEmail,
  isValidOtp,
  zodRefine,
} from "../../utils/helpers/validator.js";

/**
 * =============================================================================
 * EMAIL + PASSWORD LOGIN
 * Used for:
 *   - Super Admin login
 *   - School User login
 * =============================================================================
 */

export const emailPasswordValidation = z.object({
  email: z.string().trim().toLowerCase().superRefine(zodRefine(isValidEmail)),

  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(100, "Password too long"),
});

/**
 * =============================================================================
 * SEND OTP
 * =============================================================================
 */

export const sendOtpValidation = z.object({
  phone: z.string().trim().superRefine(zodRefine(isValidIndianPhone)),
});

/**
 * =============================================================================
 * VERIFY OTP
 * =============================================================================
 */

export const verifyOtpValidation = z.object({
  phone: z.string().trim().superRefine(zodRefine(isValidIndianPhone)),

  otp: z.string().trim().superRefine(zodRefine(isValidOtp)),
});

/**
 * =============================================================================
 * REFRESH TOKEN
 * =============================================================================
 */

export const refreshTokenValidation = z.object({
  refreshToken: z.string().min(20, "Invalid refresh token"),
});

/**
 * =============================================================================
 * LOGOUT
 * =============================================================================
 */

export const logoutValidation = z.object({
  refreshToken: z.string().optional(),
});
