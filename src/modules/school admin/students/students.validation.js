// =============================================================================
// students.validation.js — RESQID School Admin › Students
// Zod schemas — strict() on all body schemas, .transform() for normalisation
// =============================================================================

import { z } from "zod";

// ─── Shared ───────────────────────────────────────────────────────────────────

export const uuidParam = z.object({
  id: z.string().uuid("Invalid UUID"),
});

const pagination = z.object({
  page:    z.coerce.number().int().min(1).default(1),
  limit:   z.coerce.number().int().min(1).max(100).default(20),
  sortBy:  z.string().optional(),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
});

const dateRange = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to:   z.string().datetime({ offset: true }).optional(),
});

// ─── Student list ─────────────────────────────────────────────────────────────

/**
 * GET /students
 * Search by name, roll number, admission number
 * Filter by class, section, setup_stage, is_active
 */
export const listStudentsSchema = pagination.extend({
  search:      z.string().max(100).optional(),
  class:       z.string().max(20).optional(),
  section:     z.string().max(10).optional(),
  setup_stage: z.enum(["PENDING", "BASIC", "COMPLETE", "VERIFIED"]).optional(),
  is_active:   z.enum(["true", "false"]).transform((v) => v === "true").optional(),
  token_status: z
    .enum(["UNASSIGNED", "ISSUED", "ACTIVE", "INACTIVE", "REVOKED", "EXPIRED"])
    .optional(),
});

// ─── Create student ───────────────────────────────────────────────────────────

/**
 * POST /students
 */
export const createStudentSchema = z
  .object({
    first_name:       z.string().min(1, "First name required").max(100).transform((v) => v.trim()),
    last_name:        z.string().min(1, "Last name required").max(100).transform((v) => v.trim()),
    gender:           z.enum(["MALE", "FEMALE", "OTHER", "PREFER_NOT_TO_SAY"]).optional(),
    dob:              z.string().date("Invalid date — use YYYY-MM-DD").optional(),
    class:            z.string().max(20).optional(),
    section:          z.string().max(10).optional(),
    roll_number:      z.string().max(50).optional(),
    admission_number: z.string().max(50).optional(),
    photo_url:        z.string().url("Invalid photo URL").optional(),
  })
  .strict();

// ─── Update student ───────────────────────────────────────────────────────────

/**
 * PATCH /students/:id
 */
export const updateStudentSchema = z
  .object({
    first_name:       z.string().min(1).max(100).transform((v) => v.trim()).optional(),
    last_name:        z.string().min(1).max(100).transform((v) => v.trim()).optional(),
    gender:           z.enum(["MALE", "FEMALE", "OTHER", "PREFER_NOT_TO_SAY"]).optional(),
    dob:              z.string().date("Invalid date — use YYYY-MM-DD").optional(),
    class:            z.string().max(20).optional(),
    section:          z.string().max(10).optional(),
    roll_number:      z.string().max(50).optional(),
    admission_number: z.string().max(50).optional(),
    photo_url:        z.string().url("Invalid photo URL").optional(),
    setup_stage:      z.enum(["PENDING", "BASIC", "COMPLETE", "VERIFIED"]).optional(),
    is_active:        z.boolean().optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, {
    message: "At least one field must be provided",
  });

// ─── Parent requests ──────────────────────────────────────────────────────────

/**
 * GET /students/parent-requests
 */
export const listParentRequestsSchema = pagination.merge(dateRange).extend({
  status:     z.enum(["PENDING", "APPROVED", "REJECTED"]).optional(),
  student_id: z.string().uuid().optional(),
  field_group: z
    .enum(["BASIC_INFO", "EMERGENCY", "MEDICAL", "CONTACT", "DOCUMENTS"])
    .optional(),
});

/**
 * PATCH /students/parent-requests/:id/approve
 */
export const approveRequestSchema = z
  .object({
    notes: z.string().max(500).optional(),
  })
  .strict();

/**
 * PATCH /students/parent-requests/:id/reject
 */
export const rejectRequestSchema = z
  .object({
    reason: z.string().min(1, "Rejection reason required").max(500),
  })
  .strict();