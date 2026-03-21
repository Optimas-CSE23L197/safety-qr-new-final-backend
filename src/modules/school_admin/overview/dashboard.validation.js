// =============================================================================
// modules/dashboard/dashboard.validator.js — RESQID
// Runs BEFORE controller — bad input killed here, never reaches service or DB
// =============================================================================

import { z } from "zod";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const paramsSchema = z.object({
  schoolId: z
    .string({ required_error: "schoolId is required" })
    .regex(UUID_REGEX, "schoolId must be a valid UUID v4"),
});

/**
 * validateDashboardParams
 * Guards:
 *   1. schoolId must be a valid UUID v4
 *   2. Tenant isolation — auth.middleware.js sets req.user (with school_id)
 *      and req.role. School user can only access their own school.
 */
export function validateDashboardParams(req, res, next) {
  const result = paramsSchema.safeParse(req.params);

  if (!result.success) {
    return res.status(400).json({
      success: false,
      code: "VALIDATION_ERROR",
      errors: result.error.flatten().fieldErrors,
    });
  }

  // auth.middleware.js → loadUser("SCHOOL_USER") → selects { id, is_active, school_id, role }
  // So req.user.school_id is always present for authenticated school users
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
