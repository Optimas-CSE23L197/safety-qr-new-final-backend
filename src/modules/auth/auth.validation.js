// =============================================================================
// src/modules/auth/validation.js — RESQID (FIXED)
// =============================================================================

import { z } from 'zod';
import {
  isValidIndianPhone,
  isValidEmail,
  isValidOtp,
  zodRefine,
} from '#utils/helpers/validator.js';

// ─── Email + Password (Super Admin + School User login) ───────────────────────

export const emailPasswordValidation = z.object({
  email: z.string().trim().toLowerCase().superRefine(zodRefine(isValidEmail)),
  password: z.string().min(8, 'Password must be at least 8 characters').max(100),
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
  card_number: z
    .string()
    .trim()
    .min(10, 'Card number must be at least 10 characters')
    .max(20, 'Card number too long')
    .transform(v => v.toUpperCase().replace(/[^A-Z0-9-]/g, '')),
  phone: z.string().trim().superRefine(zodRefine(isValidIndianPhone)),
});

// ─── Parent Registration: Step 2 ─────────────────────────────────────────────
// nonce must match the phone used in step 1 — prevents nonce theft

export const registerVerifyValidation = z.object({
  nonce: z.string().trim().min(10, 'Invalid registration session'),
  otp: z.string().trim().superRefine(zodRefine(isValidOtp)),
  phone: z.string().trim().superRefine(zodRefine(isValidIndianPhone)),
});

// ─── Change Password ──────────────────────────────────────────────────────────

export const changePasswordValidation = z
  .object({
    oldPassword: z.string().min(8, 'Password must be at least 8 characters').max(100),
    newPassword: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .max(100)
      .refine(val => /[A-Z]/.test(val), 'Password must contain at least one uppercase letter')
      .refine(val => /[a-z]/.test(val), 'Password must contain at least one lowercase letter')
      .refine(val => /[0-9]/.test(val), 'Password must contain at least one number')
      .refine(
        val => /[^A-Za-z0-9]/.test(val),
        'Password must contain at least one special character'
      ),
  })
  .refine(data => data.oldPassword !== data.newPassword, {
    message: 'New password must be different from old password',
    path: ['newPassword'],
  });

// ─── Refresh Token ────────────────────────────────────────────────────────────

export const refreshTokenValidation = z.object({
  refreshToken: z.string().min(20, 'Invalid refresh token'),
});

// ─── Logout ───────────────────────────────────────────────────────────────────

export const logoutValidation = z.object({
  refreshToken: z.string().optional(),
});
