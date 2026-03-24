// =============================================================================
// modules/school_admin/notifications/notification.validation.js — RESQID
// =============================================================================

import { z } from "zod";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// NotificationType enum values from schema
const NOTIFICATION_TYPES = [
  "SCAN_ALERT",
  "SCAN_ANOMALY",
  "CARD_EXPIRING",
  "CARD_REVOKED",
  "CARD_REPLACED",
  "BILLING_ALERT",
  "DEVICE_LOGIN",
  "SYSTEM",
];

// ─── Shared: schoolId param guard ─────────────────────────────────────────────

const schoolParamsSchema = z.object({
  schoolId: z.string().regex(UUID_REGEX, "schoolId must be a valid UUID v4"),
});

function validateSchoolParam(req, res) {
  const result = schoolParamsSchema.safeParse(req.params);
  if (!result.success) {
    res.status(400).json({
      success: false,
      code: "VALIDATION_ERROR",
      errors: result.error.flatten().fieldErrors,
    });
    return null;
  }

  if (req.user?.school_id !== result.data.schoolId) {
    res.status(403).json({
      success: false,
      code: "FORBIDDEN",
      message: "You do not have access to this school",
    });
    return null;
  }

  return result.data;
}

// ─── GET /:schoolId/notifications ─────────────────────────────────────────────

const listQuerySchema = z.object({
  // "UNREAD" = status QUEUED only | type key to filter by type | "ALL" = everything
  filter: z.enum(["ALL", "UNREAD", ...NOTIFICATION_TYPES]).default("ALL"),

  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export function validateListNotifications(req, res, next) {
  const params = validateSchoolParam(req, res);
  if (!params) return;

  const queryResult = listQuerySchema.safeParse(req.query);
  if (!queryResult.success) {
    return res.status(400).json({
      success: false,
      code: "VALIDATION_ERROR",
      errors: queryResult.error.flatten().fieldErrors,
    });
  }

  req.validatedParams = params;
  req.validatedQuery = queryResult.data;
  next();
}

// ─── PATCH /:schoolId/notifications/:notificationId/read ──────────────────────

const notifParamsSchema = z.object({
  schoolId: z.string().regex(UUID_REGEX, "schoolId must be a valid UUID v4"),
  notificationId: z
    .string()
    .regex(UUID_REGEX, "notificationId must be a valid UUID v4"),
});

export function validateMarkRead(req, res, next) {
  const result = notifParamsSchema.safeParse(req.params);
  if (!result.success) {
    return res.status(400).json({
      success: false,
      code: "VALIDATION_ERROR",
      errors: result.error.flatten().fieldErrors,
    });
  }

  if (req.user?.school_id !== result.data.schoolId) {
    return res.status(403).json({
      success: false,
      code: "FORBIDDEN",
      message: "You do not have access to this school",
    });
  }

  req.validatedParams = result.data;
  next();
}

// ─── PATCH /:schoolId/notifications/read-all ──────────────────────────────────
// No body, no extra params — schoolId guard is enough

export function validateMarkAllRead(req, res, next) {
  const params = validateSchoolParam(req, res);
  if (!params) return;

  req.validatedParams = params;
  next();
}
