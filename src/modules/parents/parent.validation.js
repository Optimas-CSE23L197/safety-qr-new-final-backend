// =============================================================================
// modules/parents/parent.validation.js — RESQID
// ALL validation for parent endpoints in one file.
// Every validator rejects bad input before it reaches service/DB.
// =============================================================================

import { z } from "zod";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const PHONE_REGEX = /^\+[1-9]\d{9,14}$/; // E.164 format

// ─── Shared guard ─────────────────────────────────────────────────────────────

/**
 * requireOwnParent(req, res)
 * parentId ALWAYS comes from JWT — never from body or params.
 * Returns parentId or sends 403 and returns null.
 */
export function requireOwnParent(req, res) {
  if (!req.userId || req.role !== "PARENT_USER") {
    res
      .status(403)
      .json({ success: false, code: "FORBIDDEN", message: "Access denied" });
    return null;
  }
  return req.userId;
}

// ─── GET /me/scans ────────────────────────────────────────────────────────────

const scanHistorySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  // Client-side filter — passed to API for server-side filtering
  filter: z.enum(["all", "emergency", "success", "flagged"]).default("all"),
});

export function validateScanHistoryQuery(req, res, next) {
  const result = scanHistorySchema.safeParse(req.query);
  if (!result.success) {
    return res.status(400).json({
      success: false,
      code: "VALIDATION_ERROR",
      errors: result.error.flatten().fieldErrors,
    });
  }
  req.validatedQuery = result.data;
  next();
}

// ─── PATCH /me/profile ────────────────────────────────────────────────────────
// 4-step wizard submits everything in one batched call
// All fields optional — partial updates allowed
// studentId required to know which student to update

const BLOOD_GROUPS = [
  "A_POS",
  "A_NEG",
  "B_POS",
  "B_NEG",
  "O_POS",
  "O_NEG",
  "AB_POS",
  "AB_NEG",
  "UNKNOWN",
];

const contactSchema = z.object({
  id: z.string().regex(UUID_REGEX).optional(), // present on edit, absent on new
  name: z
    .string()
    .min(1)
    .max(100)
    .transform((v) => v.trim()),
  phone: z
    .string()
    .regex(PHONE_REGEX, "Phone must be E.164 format e.g. +919876543210"),
  relationship: z
    .string()
    .max(50)
    .optional()
    .transform((v) => v?.trim()),
  priority: z.number().int().min(1).max(10),
});

const updateProfileSchema = z.object({
  student_id: z
    .string({ required_error: "student_id is required" })
    .regex(UUID_REGEX, "student_id must be a valid UUID"),

  student: z
    .object({
      first_name: z
        .string()
        .min(1)
        .max(100)
        .transform((v) => v.trim())
        .optional(),
      last_name: z
        .string()
        .min(1)
        .max(100)
        .transform((v) => v.trim())
        .optional(),
      class: z
        .string()
        .max(20)
        .transform((v) => v.trim())
        .optional(),
      section: z
        .string()
        .max(5)
        .transform((v) => v.trim())
        .optional(),
    })
    .optional(),

  emergency: z
    .object({
      blood_group: z.enum(BLOOD_GROUPS).optional(),
      allergies: z
        .string()
        .max(500)
        .transform((v) => v.trim())
        .optional(),
      conditions: z
        .string()
        .max(500)
        .transform((v) => v.trim())
        .optional(),
      medications: z
        .string()
        .max(500)
        .transform((v) => v.trim())
        .optional(),
      doctor_name: z
        .string()
        .max(100)
        .transform((v) => v.trim())
        .optional(),
      doctor_phone: z.string().regex(PHONE_REGEX).optional(),
      notes: z
        .string()
        .max(1000)
        .transform((v) => v.trim())
        .optional(),
    })
    .optional(),

  // Replace all contacts atomically — client sends the full list
  contacts: z.array(contactSchema).max(10).optional(),
});

export function validateUpdateProfile(req, res, next) {
  const result = updateProfileSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({
      success: false,
      code: "VALIDATION_ERROR",
      errors: result.error.flatten().fieldErrors,
    });
  }
  req.validatedBody = result.data;
  next();
}

// ─── PATCH /me/visibility ─────────────────────────────────────────────────────

const VALID_FIELDS = [
  "blood_group",
  "allergies",
  "conditions",
  "medications",
  "doctor_name",
  "doctor_phone",
  "notes",
  "contacts",
];

const updateVisibilitySchema = z.object({
  student_id: z.string().regex(UUID_REGEX),
  visibility: z.enum(["PUBLIC", "MINIMAL", "HIDDEN"]),
  hidden_fields: z.array(z.enum(VALID_FIELDS)).default([]),
});

export function validateUpdateVisibility(req, res, next) {
  const result = updateVisibilitySchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({
      success: false,
      code: "VALIDATION_ERROR",
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
      code: "VALIDATION_ERROR",
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
      code: "VALIDATION_ERROR",
      errors: result.error.flatten().fieldErrors,
    });
  }
  req.validatedBody = result.data;
  next();
}

// ─── POST /me/lock-card ───────────────────────────────────────────────────────
// Requires confirmation string "LOCK" to prevent accidental locks

const lockCardSchema = z.object({
  student_id: z.string().regex(UUID_REGEX),
  confirmation: z.literal("LOCK", {
    errorMap: () => ({ message: 'Type "LOCK" to confirm' }),
  }),
});

export function validateLockCard(req, res, next) {
  const result = lockCardSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({
      success: false,
      code: "VALIDATION_ERROR",
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
    .transform((v) => v.trim()),
});

export function validateRequestReplace(req, res, next) {
  const result = requestReplaceSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({
      success: false,
      code: "VALIDATION_ERROR",
      errors: result.error.flatten().fieldErrors,
    });
  }
  req.validatedBody = result.data;
  next();
}
