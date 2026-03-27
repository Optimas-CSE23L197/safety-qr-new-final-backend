// =============================================================================
// modules/school_admin/card_requests/cardRequests.validation.js — RESQID
// =============================================================================

import { z } from 'zod';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const PINCODE_REGEX = /^\d{6}$/;

const paramsSchema = z.object({
  schoolId: z.string().regex(UUID_REGEX, 'schoolId must be a valid UUID v4'),
});

// ── GET list query params ─────────────────────────────────────────────────────
export const listQuerySchema = z.object({
  status: z.enum(['ALL', 'PENDING', 'APPROVED', 'REJECTED']).default('ALL'),
  search: z
    .string()
    .max(100)
    .optional()
    .transform(v => v?.trim() || undefined),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

// ── POST body ─────────────────────────────────────────────────────────────────
// School admin submits: card_count + notes + delivery address
// school_id is NEVER taken from body — always from JWT via req.user.school_id
export const createBodySchema = z.object({
  card_count: z
    .number({ required_error: 'card_count is required' })
    .int('Must be a whole number')
    .min(1, 'Minimum 1 card')
    .max(300, 'Maximum 300 cards per request'),

  notes: z
    .string({ required_error: 'notes is required' })
    .min(10, 'Please provide at least 10 characters')
    .max(500, 'Notes cannot exceed 500 characters')
    .transform(v => v.trim()),

  // Delivery address — all required except line2
  delivery_name: z
    .string()
    .min(2)
    .max(100)
    .transform(v => v.trim()),
  delivery_phone: z
    .string()
    .min(10)
    .max(15)
    .transform(v => v.trim()),
  delivery_address: z
    .string()
    .min(5)
    .max(200)
    .transform(v => v.trim()),
  delivery_line2: z
    .string()
    .max(100)
    .optional()
    .transform(v => v?.trim() || undefined),
  delivery_city: z
    .string()
    .min(2)
    .max(100)
    .transform(v => v.trim()),
  delivery_state: z
    .string()
    .min(2)
    .max(100)
    .transform(v => v.trim()),
  delivery_pincode: z.string().regex(PINCODE_REGEX, 'Pincode must be exactly 6 digits'),

  // Order type — school can choose BLANK or PRE_DETAILS
  order_type: z.enum(['BLANK', 'PRE_DETAILS']).default('BLANK'),
});

// ─── Middleware ───────────────────────────────────────────────────────────────

function validateParams(req, res) {
  const result = paramsSchema.safeParse(req.params);
  if (!result.success) {
    res.status(400).json({
      success: false,
      code: 'VALIDATION_ERROR',
      errors: result.error.flatten().fieldErrors,
    });
    return null;
  }

  // Tenant isolation — school user can only access their own school
  if (req.user?.school_id !== result.data.schoolId) {
    res.status(403).json({
      success: false,
      code: 'FORBIDDEN',
      message: 'You do not have access to this school',
    });
    return null;
  }

  return result.data;
}

export function validateListCardRequests(req, res, next) {
  const params = validateParams(req, res);
  if (!params) return;

  const queryResult = listQuerySchema.safeParse(req.query);
  if (!queryResult.success) {
    return res.status(400).json({
      success: false,
      code: 'VALIDATION_ERROR',
      errors: queryResult.error.flatten().fieldErrors,
    });
  }

  req.validatedParams = params;
  req.validatedQuery = queryResult.data;
  next();
}

export function validateCreateCardRequest(req, res, next) {
  const params = validateParams(req, res);
  if (!params) return;

  const bodyResult = createBodySchema.safeParse(req.body);
  if (!bodyResult.success) {
    return res.status(400).json({
      success: false,
      code: 'VALIDATION_ERROR',
      errors: bodyResult.error.flatten().fieldErrors,
    });
  }

  req.validatedParams = params;
  req.validatedBody = bodyResult.data;
  next();
}
