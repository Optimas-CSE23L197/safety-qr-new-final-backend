// =============================================================================
// modules/school_admin/anomalies/anomaly.validation.js — RESQID
// =============================================================================

import { z } from "zod";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// All AnomalyType values from schema
const ANOMALY_TYPES = [
  "HIGH_FREQUENCY",
  "MULTIPLE_LOCATIONS",
  "SUSPICIOUS_IP",
  "AFTER_HOURS",
  "BULK_SCRAPING",
  "HONEYPOT_TRIGGERED",
  "REPEATED_FAILURE",
];

// ─── Shared: schoolId param guard ─────────────────────────────────────────────

const paramsSchema = z.object({
  schoolId: z.string().regex(UUID_REGEX, "schoolId must be a valid UUID v4"),
});

function validateSchoolParam(req, res) {
  const result = paramsSchema.safeParse(req.params);
  if (!result.success) {
    res.status(400).json({
      success: false,
      code: "VALIDATION_ERROR",
      errors: result.error.flatten().fieldErrors,
    });
    return null;
  }

  // School-scoped guard
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

// ─── GET /:schoolId/anomalies ─────────────────────────────────────────────────

const listQuerySchema = z.object({
  // Resolved filter
  // UNRESOLVED (default) | RESOLVED | ALL
  filter: z.enum(["ALL", "UNRESOLVED", "RESOLVED"]).default("UNRESOLVED"),

  // Narrow by anomaly type
  type: z.enum(["ALL", ...ANOMALY_TYPES]).default("ALL"),

  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export function validateListAnomalies(req, res, next) {
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

// ─── PATCH /:schoolId/anomalies/:anomalyId/resolve ────────────────────────────

const resolveParamsSchema = z.object({
  schoolId: z.string().regex(UUID_REGEX, "schoolId must be a valid UUID v4"),
  anomalyId: z.string().regex(UUID_REGEX, "anomalyId must be a valid UUID v4"),
});

const resolveBodySchema = z.object({
  // Notes are optional — frontend textarea can be left blank
  notes: z
    .string()
    .max(1000)
    .optional()
    .transform((v) => v?.trim() || null),
});

export function validateResolveAnomaly(req, res, next) {
  // Validate both params together
  const paramsResult = resolveParamsSchema.safeParse(req.params);
  if (!paramsResult.success) {
    return res.status(400).json({
      success: false,
      code: "VALIDATION_ERROR",
      errors: paramsResult.error.flatten().fieldErrors,
    });
  }

  // School-scoped guard
  if (req.user?.school_id !== paramsResult.data.schoolId) {
    return res.status(403).json({
      success: false,
      code: "FORBIDDEN",
      message: "You do not have access to this school",
    });
  }

  const bodyResult = resolveBodySchema.safeParse(req.body);
  if (!bodyResult.success) {
    return res.status(400).json({
      success: false,
      code: "VALIDATION_ERROR",
      errors: bodyResult.error.flatten().fieldErrors,
    });
  }

  req.validatedParams = paramsResult.data;
  req.validatedBody = bodyResult.data;
  next();
}
