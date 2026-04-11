// =============================================================================
// modules/parents/parent.validation.js — RESQID (FULLY FIXED)
// ALL validation for parent endpoints in one file.
// Every validator rejects bad input before it reaches service/DB.
// =============================================================================

import { z } from 'zod';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// E.164 format: + followed by 10-15 digits
const PHONE_REGEX = /^\+[1-9]\d{9,14}$/;

// ─── Shared guard ─────────────────────────────────────────────────────────────

export function requireOwnParent(req, res) {
  if (!req.userId || req.role !== 'PARENT_USER') {
    res.status(403).json({
      success: false,
      code: 'FORBIDDEN',
      message: 'Access denied',
    });
    return null;
  }
  return req.userId;
}

// ─── Normalise phone to E.164 (dynamic country code detection) ────────────────
// Accepts: "+919876543210", "9876543210", "09876543210"
// Rejects: 'abc', '123', empty after normalisation
// Detects country code from input or defaults to +91 for Indian numbers

function normalisePhone(v) {
  if (!v || v.trim() === '') return undefined;
  const t = v.trim();

  // Already E.164 format
  if (t.startsWith('+')) return t;

  // Remove leading zeros
  const cleaned = t.replace(/^0+/, '');

  // If starts with 91 and length is 12 (including 91), assume Indian
  if (cleaned.startsWith('91') && cleaned.length === 12) {
    return `+${cleaned}`;
  }

  // If length is 10, assume Indian number (default to +91)
  if (cleaned.length === 10 && /^[6-9]\d{9}$/.test(cleaned)) {
    return `+91${cleaned}`;
  }

  // If length is 11 and starts with 0 (after cleaning), treat as Indian
  if (cleaned.length === 11 && cleaned.startsWith('0')) {
    return `+91${cleaned.slice(1)}`;
  }

  // Otherwise, assume already has country code without +
  if (/^[1-9]\d{9,14}$/.test(cleaned)) {
    return `+${cleaned}`;
  }

  return undefined;
}

// ─── GET /me/scans ────────────────────────────────────────────────────────────

const scanHistorySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  filter: z.enum(['all', 'emergency', 'success', 'flagged']).default('all'),
});

export function validateScanHistoryQuery(req, res, next) {
  const result = scanHistorySchema.safeParse(req.query);
  if (!result.success) {
    return res.status(400).json({
      success: false,
      code: 'VALIDATION_ERROR',
      errors: result.error.flatten().fieldErrors,
    });
  }
  req.validatedQuery = result.data;
  next();
}

// ─── PATCH /me/profile ────────────────────────────────────────────────────────

const BLOOD_GROUPS = [
  'A_POS',
  'A_NEG',
  'B_POS',
  'B_NEG',
  'O_POS',
  'O_NEG',
  'AB_POS',
  'AB_NEG',
  'UNKNOWN',
];

const BLOOD_GROUP_MAP = {
  'A+': 'A_POS',
  'A-': 'A_NEG',
  'A−': 'A_NEG',
  'B+': 'B_POS',
  'B-': 'B_NEG',
  'B−': 'B_NEG',
  'O+': 'O_POS',
  'O-': 'O_NEG',
  'O−': 'O_NEG',
  'AB+': 'AB_POS',
  'AB-': 'AB_NEG',
  'AB−': 'AB_NEG',
  Unknown: 'UNKNOWN',
  unknown: 'UNKNOWN',
  UNKNOWN: 'UNKNOWN',
};

const contactSchema = z.object({
  id: z.string().regex(UUID_REGEX).optional().catch(undefined),
  name: z
    .string()
    .min(1)
    .max(100)
    .transform(v => v.trim()),
  phone: z
    .string()
    .min(1, 'Contact phone is required')
    .transform(normalisePhone)
    .pipe(z.string().regex(PHONE_REGEX, 'Phone must be a valid number e.g. +919876543210')),
  relationship: z
    .string()
    .max(50)
    .optional()
    .transform(v => v?.trim()),
  priority: z.number().int().min(1).max(10),
});

const updateProfileSchema = z.object({
  student_id: z
    .string({ required_error: 'student_id is required' })
    .regex(UUID_REGEX, 'student_id must be a valid UUID'),
  student: z
    .object({
      first_name: z
        .string()
        .min(1)
        .max(100)
        .transform(v => v.trim())
        .optional(),
      last_name: z
        .string()
        .min(1)
        .max(100)
        .transform(v => v.trim())
        .optional(),
      class: z
        .string()
        .max(50)
        .transform(v => v.trim())
        .optional(),
      section: z
        .string()
        .max(30)
        .transform(v => v.trim())
        .optional(),
    })
    .optional(),
  emergency: z
    .object({
      blood_group: z
        .string()
        .optional()
        .transform(v => {
          if (!v) return undefined;
          return BLOOD_GROUP_MAP[v] ?? (BLOOD_GROUPS.includes(v) ? v : undefined);
        })
        .pipe(z.enum(BLOOD_GROUPS).optional()),
      allergies: z
        .string()
        .max(500)
        .transform(v => v.trim() || undefined)
        .optional(),
      conditions: z
        .string()
        .max(500)
        .transform(v => v.trim())
        .optional(),
      medications: z
        .string()
        .max(500)
        .transform(v => v.trim())
        .optional(),
      doctor_name: z
        .string()
        .max(100)
        .transform(v => v.trim() || undefined)
        .optional(),
      doctor_phone: z
        .string()
        .optional()
        .transform(normalisePhone)
        .pipe(
          z
            .string()
            .regex(PHONE_REGEX, 'Doctor phone must be a valid number e.g. +919876543210')
            .optional()
        ),
      notes: z
        .string()
        .max(1000)
        .transform(v => v.trim())
        .optional(),
    })
    .optional(),
  contacts: z.array(contactSchema).max(10).optional(),
});

export function validateUpdateProfile(req, res, next) {
  const result = updateProfileSchema.safeParse(req.body);
  if (!result.success) {
    console.error('[VALIDATION FAIL] body:', JSON.stringify(req.body, null, 2));
    console.error('[VALIDATION FAIL] errors:', JSON.stringify(result.error.flatten(), null, 2));
    return res.status(400).json({
      success: false,
      code: 'VALIDATION_ERROR',
      errors: result.error.flatten().fieldErrors,
    });
  }
  req.validatedBody = result.data;
  next();
}

// ─── PATCH /me/visibility ─────────────────────────────────────────────────────

const VALID_FIELDS = [
  'blood_group',
  'allergies',
  'conditions',
  'medications',
  'doctor_name',
  'doctor_phone',
  'notes',
  'contacts',
];

const updateVisibilitySchema = z.object({
  student_id: z.string().regex(UUID_REGEX),
  visibility: z.enum(['PUBLIC', 'MINIMAL', 'HIDDEN']),
  hidden_fields: z.array(z.enum(VALID_FIELDS)).default([]),
});

export function validateUpdateVisibility(req, res, next) {
  const result = updateVisibilitySchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({
      success: false,
      code: 'VALIDATION_ERROR',
      errors: result.error.flatten().fieldErrors,
    });
  }
  req.validatedBody = result.data;
  next();
}

// ─── PATCH /me/notifications ──────────────────────────────────────────────────

const updateNotificationsSchema = z.object({
  scan_notify_enabled: z.boolean().optional(),
  scan_notify_push: z.boolean().optional(),
  scan_notify_sms: z.boolean().optional(),
  anomaly_notify_push: z.boolean().optional(),
  anomaly_notify_sms: z.boolean().optional(),
  card_expiry_notify: z.boolean().optional(),
  quiet_hours_enabled: z.boolean().optional(),
  quiet_hours_start: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
  quiet_hours_end: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
});

export function validateUpdateNotifications(req, res, next) {
  const result = updateNotificationsSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({
      success: false,
      code: 'VALIDATION_ERROR',
      errors: result.error.flatten().fieldErrors,
    });
  }
  req.validatedBody = result.data;
  next();
}

// ─── PATCH /me/location-consent ───────────────────────────────────────────────

const updateLocationConsentSchema = z.object({
  student_id: z.string().regex(UUID_REGEX),
  enabled: z.boolean(),
});

export function validateUpdateLocationConsent(req, res, next) {
  const result = updateLocationConsentSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({
      success: false,
      code: 'VALIDATION_ERROR',
      errors: result.error.flatten().fieldErrors,
    });
  }
  req.validatedBody = result.data;
  next();
}

// ─── POST /me/lock-card ───────────────────────────────────────────────────────

const lockCardSchema = z.object({
  student_id: z.string().regex(UUID_REGEX),
  confirmation: z.literal('LOCK', {
    errorMap: () => ({ message: "Type 'LOCK' to confirm" }),
  }),
});

export function validateLockCard(req, res, next) {
  const result = lockCardSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({
      success: false,
      code: 'VALIDATION_ERROR',
      errors: result.error.flatten().fieldErrors,
    });
  }
  req.validatedBody = result.data;
  next();
}

// ─── POST /me/request-replace ────────────────────────────────────────────────

const requestReplaceSchema = z.object({
  student_id: z.string().regex(UUID_REGEX),
  reason: z
    .string()
    .min(5)
    .max(500)
    .transform(v => v.trim()),
});

export function validateRequestReplace(req, res, next) {
  const result = requestReplaceSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({
      success: false,
      code: 'VALIDATION_ERROR',
      errors: result.error.flatten().fieldErrors,
    });
  }
  req.validatedBody = result.data;
  next();
}

// ─── GET /me/location-history ─────────────────────────────────────────────────

const locationHistorySchema = z.object({
  student_id: z.string().regex(UUID_REGEX, 'student_id must be a valid UUID'),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  from_date: z.string().datetime().optional(),
  to_date: z.string().datetime().optional(),
});

export function validateLocationHistoryQuery(req, res, next) {
  const result = locationHistorySchema.safeParse(req.query);
  if (!result.success) {
    return res.status(400).json({
      success: false,
      code: 'VALIDATION_ERROR',
      errors: result.error.flatten().fieldErrors,
    });
  }
  req.validatedQuery = result.data;
  next();
}

// ─── GET /me/anomalies ───────────────────────────────────────────────────────

const anomaliesSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  resolved: z.enum(['true', 'false']).optional(),
});

export function validateAnomaliesQuery(req, res, next) {
  const result = anomaliesSchema.safeParse(req.query);
  if (!result.success) {
    return res.status(400).json({
      success: false,
      code: 'VALIDATION_ERROR',
      errors: result.error.flatten().fieldErrors,
    });
  }
  req.validatedQuery = result.data;
  next();
}

// ─── POST /me/request-renewal ─────────────────────────────────────────────────

const requestRenewalSchema = z.object({
  card_id: z.string().regex(UUID_REGEX),
  payment_method: z.enum(['UPI', 'CARD', 'NETBANKING', 'WALLET']),
});

export function validateRequestRenewal(req, res, next) {
  const result = requestRenewalSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({
      success: false,
      code: 'VALIDATION_ERROR',
      errors: result.error.flatten().fieldErrors,
    });
  }
  req.validatedBody = result.data;
  next();
}

// ─── POST /me/change-phone ───────────────────────────────────────────────────

const changePhoneSchema = z.object({
  new_phone: z
    .string()
    .transform(normalisePhone)
    .pipe(z.string().regex(PHONE_REGEX, 'Phone must be a valid number e.g. +919876543210')),
  otp: z.string().length(6, 'OTP must be 6 digits'),
});

export function validateChangePhone(req, res, next) {
  const result = changePhoneSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({
      success: false,
      code: 'VALIDATION_ERROR',
      errors: result.error.flatten().fieldErrors,
    });
  }
  req.validatedBody = result.data;
  next();
}

// ─── POST /me/send-phone-otp ─────────────────────────────────────────────────

const sendPhoneOtpSchema = z.object({
  new_phone: z
    .string()
    .transform(normalisePhone)
    .pipe(z.string().regex(PHONE_REGEX, 'Phone must be a valid number e.g. +919876543210')),
});

export function validateSendPhoneOtp(req, res, next) {
  const result = sendPhoneOtpSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({
      success: false,
      code: 'VALIDATION_ERROR',
      errors: result.error.flatten().fieldErrors,
    });
  }
  req.validatedBody = result.data;
  next();
}

// ─── POST /me/device-token ───────────────────────────────────────────────────

const registerDeviceTokenSchema = z.object({
  token: z.string().min(10, 'token is required'),
  platform: z.enum(['IOS', 'ANDROID', 'WEB']),
  device_name: z.string().max(100).nullable().optional(),
  deviceModel: z.string().max(100).nullable().optional(),
  os_version: z.string().max(50).nullable().optional(),
});

export function validateRegisterDeviceToken(req, res, next) {
  const result = registerDeviceTokenSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({
      success: false,
      code: 'VALIDATION_ERROR',
      errors: result.error.flatten().fieldErrors,
    });
  }
  req.validatedBody = result.data;
  next();
}

// =============================================================================
// MULTI-CHILD SUPPORT — NEW VALIDATION SCHEMAS
// =============================================================================

// ─── POST /me/link-card ───────────────────────────────────────────────────────
// Add a new child by scanning a new card
// Card number format: alphanumeric with hyphens, 10-20 chars
const linkCardSchema = z.object({
  card_number: z
    .string()
    .trim()
    .min(10, 'Card number must be at least 10 characters')
    .max(20, 'Card number too long')
    .transform(v => v.toUpperCase().replace(/[^A-Z0-9-]/g, '')),
});

export function validateLinkCard(req, res, next) {
  const result = linkCardSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({
      success: false,
      code: 'VALIDATION_ERROR',
      errors: result.error.flatten().fieldErrors,
    });
  }
  req.validatedBody = result.data;
  next();
}

// ─── PATCH /me/active-student ─────────────────────────────────────────────────
// Switch active student for parent

const setActiveStudentSchema = z.object({
  student_id: z
    .string({ required_error: 'student_id is required' })
    .regex(UUID_REGEX, 'student_id must be a valid UUID'),
});

export function validateSetActiveStudent(req, res, next) {
  const result = setActiveStudentSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({
      success: false,
      code: 'VALIDATION_ERROR',
      errors: result.error.flatten().fieldErrors,
    });
  }
  req.validatedBody = result.data;
  next();
}
