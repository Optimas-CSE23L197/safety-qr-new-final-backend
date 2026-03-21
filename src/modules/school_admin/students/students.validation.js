// =============================================================================
// modules/school_admin/students/students.validation.js — RESQID
// Validates + sanitizes all query params before they touch the service/DB.
// Bad input rejected here — never reaches Prisma.
// =============================================================================

import { z } from "zod";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Valid token statuses the frontend filter sends
const TOKEN_STATUSES = [
  "ACTIVE",
  "UNASSIGNED",
  "EXPIRED",
  "REVOKED",
  "ISSUED",
  "INACTIVE",
];

// Valid sort fields — whitelist prevents SQL injection via orderBy
const SORT_FIELDS = ["first_name", "class", "created_at"];

const paramsSchema = z.object({
  schoolId: z.string().regex(UUID_REGEX, "schoolId must be a valid UUID v4"),
});

const querySchema = z.object({
  // Pagination
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),

  // Search — strip dangerous chars, max 100 chars
  search: z
    .string()
    .max(100)
    .optional()
    .transform((v) => v?.trim() || undefined),

  // Filters — must match known enum values exactly
  class: z
    .string()
    .max(20)
    .optional()
    .transform((v) => v?.trim() || undefined),
  section: z
    .string()
    .max(5)
    .optional()
    .transform((v) => v?.trim() || undefined),
  token_status: z.enum(TOKEN_STATUSES).optional(),

  // Sort — whitelist only, no arbitrary field injection
  sort_field: z.enum(SORT_FIELDS).default("first_name"),
  sort_dir: z.enum(["asc", "desc"]).default("asc"),
});

export function validateStudentsQuery(req, res, next) {
  // [1] Validate schoolId param
  const paramResult = paramsSchema.safeParse(req.params);
  if (!paramResult.success) {
    return res.status(400).json({
      success: false,
      code: "VALIDATION_ERROR",
      errors: paramResult.error.flatten().fieldErrors,
    });
  }

  // [2] Tenant isolation
  if (req.user?.school_id !== paramResult.data.schoolId) {
    return res.status(403).json({
      success: false,
      code: "FORBIDDEN",
      message: "You do not have access to this school",
    });
  }

  // [3] Validate query params
  const queryResult = querySchema.safeParse(req.query);
  if (!queryResult.success) {
    return res.status(400).json({
      success: false,
      code: "VALIDATION_ERROR",
      errors: queryResult.error.flatten().fieldErrors,
    });
  }

  req.validatedParams = paramResult.data;
  req.validatedQuery = queryResult.data;
  next();
}
