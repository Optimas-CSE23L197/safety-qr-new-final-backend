// =============================================================================
// modules/school_admin/qr/qr.validation.js — RESQID
// =============================================================================

import { z } from 'zod';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const paramsSchema = z.object({
  schoolId: z.string().regex(UUID_REGEX, 'schoolId must be a valid UUID v4'),
});

const paramsWithStudentSchema = paramsSchema.extend({
  studentId: z.string().regex(UUID_REGEX, 'studentId must be a valid UUID v4'),
});

// ── List query ────────────────────────────────────────────────────────────────
const listQuerySchema = z.object({
  search: z
    .string()
    .max(100)
    .optional()
    .transform(v => v?.trim() || undefined),
  // QR status filter: all | ready (has active token+QR) | no_token
  filter: z.enum(['all', 'ready', 'no_token']).default('all'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// ── Assign token body ─────────────────────────────────────────────────────────
// School admin picks an unassigned token from their inventory to link
const assignBodySchema = z.object({
  token_id: z
    .string({ required_error: 'token_id is required' })
    .regex(UUID_REGEX, 'token_id must be a valid UUID v4'),
});

// ─── Shared param validator ───────────────────────────────────────────────────

function checkTenant(req, res, schoolId) {
  if (req.user?.school_id !== schoolId) {
    res.status(403).json({
      success: false,
      code: 'FORBIDDEN',
      message: 'You do not have access to this school',
    });
    return false;
  }
  return true;
}

// ─── Middleware ───────────────────────────────────────────────────────────────

export function validateListQr(req, res, next) {
  const paramResult = paramsSchema.safeParse(req.params);
  if (!paramResult.success) {
    return res.status(400).json({
      success: false,
      code: 'VALIDATION_ERROR',
      errors: paramResult.error.flatten().fieldErrors,
    });
  }
  if (!checkTenant(req, res, paramResult.data.schoolId)) return;

  const queryResult = listQuerySchema.safeParse(req.query);
  if (!queryResult.success) {
    return res.status(400).json({
      success: false,
      code: 'VALIDATION_ERROR',
      errors: queryResult.error.flatten().fieldErrors,
    });
  }

  req.validatedParams = paramResult.data;
  req.validatedQuery = queryResult.data;
  next();
}

export function validateGetStudentQr(req, res, next) {
  const result = paramsWithStudentSchema.safeParse(req.params);
  if (!result.success) {
    return res.status(400).json({
      success: false,
      code: 'VALIDATION_ERROR',
      errors: result.error.flatten().fieldErrors,
    });
  }
  if (!checkTenant(req, res, result.data.schoolId)) return;

  req.validatedParams = result.data;
  next();
}

export function validateAssignToken(req, res, next) {
  const paramResult = paramsWithStudentSchema.safeParse(req.params);
  if (!paramResult.success) {
    return res.status(400).json({
      success: false,
      code: 'VALIDATION_ERROR',
      errors: paramResult.error.flatten().fieldErrors,
    });
  }
  if (!checkTenant(req, res, paramResult.data.schoolId)) return;

  const bodyResult = assignBodySchema.safeParse(req.body);
  if (!bodyResult.success) {
    return res.status(400).json({
      success: false,
      code: 'VALIDATION_ERROR',
      errors: bodyResult.error.flatten().fieldErrors,
    });
  }

  req.validatedParams = paramResult.data;
  req.validatedBody = bodyResult.data;
  next();
}
