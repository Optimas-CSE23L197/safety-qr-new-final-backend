// =============================================================================
// modules/school_admin/tokens/tokens.validation.js — RESQID
// =============================================================================

import { z } from "zod";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const TOKEN_STATUSES = [
  "ACTIVE",
  "UNASSIGNED",
  "ISSUED",
  "EXPIRED",
  "REVOKED",
  "INACTIVE",
];

const paramsSchema = z.object({
  schoolId: z.string().regex(UUID_REGEX, "schoolId must be a valid UUID v4"),
});

const querySchema = z.object({
  status: z.enum(["ALL", ...TOKEN_STATUSES]).default("ALL"),

  // Search: token_hash prefix OR student name
  search: z
    .string()
    .max(100)
    .optional()
    .transform((v) => v?.trim() || undefined),

  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(12),
});

function validateParams(req, res) {
  const result = paramsSchema.safeParse(req.params);
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

export function validateListTokens(req, res, next) {
  const params = validateParams(req, res);
  if (!params) return;

  const queryResult = querySchema.safeParse(req.query);
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
