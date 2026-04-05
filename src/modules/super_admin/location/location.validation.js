import { z } from 'zod';

// ── GET /api/super/location/overview ─────────────────────────────────────────
// Returns KPI stats + school allow_location flags in one shot
export const overviewSchema = z.object({});

// ── GET /api/super/location/students ─────────────────────────────────────────
// List students with consent + last_event + in_zone flag
export const studentsQuerySchema = z.object({
  school_id: z.string().uuid().optional(),
  consent: z.enum(['ALL', 'GRANTED', 'REVOKED']).default('ALL'),
  zone: z.enum(['ALL', 'IN_ZONE', 'OUTSIDE']).default('ALL'),
  source: z.enum(['ALL', 'SCAN_TRIGGER', 'PARENT_APP', 'MANUAL']).default('ALL'),
  search: z.string().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(15),
});

// ── GET /api/super/location/students/:studentId/history ──────────────────────
// Paginated location event history for one student
export const historyParamsSchema = z.object({
  studentId: z.string().uuid(),
});

export const historyQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

// ── GET /api/super/location/zones ────────────────────────────────────────────
// All trusted scan zones, optionally filtered by school
export const zonesQuerySchema = z.object({
  school_id: z.string().uuid().optional(),
});
