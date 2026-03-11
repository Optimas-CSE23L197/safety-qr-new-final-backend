// =============================================================================
// monitoring.validation.js — RESQID School Admin
// Zod schemas for all monitoring endpoints
// =============================================================================

import { z } from "zod";

// ─── Reusables ────────────────────────────────────────────────────────────────

export const uuidParam = z.object({
  id: z.string().uuid("Invalid UUID"),
});

const pagination = z.object({
  page:    z.coerce.number().int().min(1).default(1),
  limit:   z.coerce.number().int().min(1).max(100).default(20),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
});

const dateRange = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to:   z.string().datetime({ offset: true }).optional(),
});

// ─── Overview / Dashboard stats ───────────────────────────────────────────────

/**
 * GET /monitoring/stats
 * KPI cards + chart data for the monitoring dashboard
 */
export const statsQuerySchema = dateRange;

// ─── Student Activity ─────────────────────────────────────────────────────────

/**
 * GET /monitoring/students
 * Students with their scan count, last seen, token status
 */
export const studentActivityQuerySchema = pagination.extend({
  search:      z.string().max(100).optional(),
  class:       z.string().max(20).optional(),
  section:     z.string().max(10).optional(),
  has_scanned: z.enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  token_status: z
    .enum(["UNASSIGNED", "ISSUED", "ACTIVE", "INACTIVE", "REVOKED", "EXPIRED"])
    .optional(),
});

// ─── Token Monitoring ─────────────────────────────────────────────────────────

/**
 * GET /monitoring/tokens
 */
export const tokenMonitorQuerySchema = pagination.extend({
  status:   z.enum(["UNASSIGNED", "ISSUED", "ACTIVE", "INACTIVE", "REVOKED", "EXPIRED"]).optional(),
  expiring: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
});

// ─── Scan Logs ────────────────────────────────────────────────────────────────

/**
 * GET /monitoring/scan-logs
 */
export const scanLogQuerySchema = pagination.merge(dateRange).extend({
  result:     z.enum(["SUCCESS", "INVALID", "REVOKED", "EXPIRED", "INACTIVE", "RATE_LIMITED", "ERROR"]).optional(),
  student_id: z.string().uuid().optional(),
  token_id:   z.string().uuid().optional(),
});

// ─── Anomalies ────────────────────────────────────────────────────────────────

/**
 * GET /monitoring/anomalies
 */
export const anomalyQuerySchema = pagination.merge(dateRange).extend({
  severity: z
    .enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"])
    .optional(),
  type: z
    .enum([
      "HIGH_FREQUENCY",
      "MULTIPLE_LOCATIONS",
      "SUSPICIOUS_IP",
      "AFTER_HOURS",
      "BULK_SCRAPING",
      "HONEYPOT_TRIGGERED",
      "REPEATED_FAILURE",
    ])
    .optional(),
  resolved: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
});

/**
 * PATCH /monitoring/anomalies/:id/resolve
 */
export const resolveAnomalySchema = z
  .object({
    notes: z.string().max(500).optional(),
  })
  .strict();

// ─── Parent Requests ──────────────────────────────────────────────────────────

/**
 * GET /monitoring/parent-requests
 */
export const parentRequestQuerySchema = pagination.merge(dateRange).extend({
  field_group: z
    .enum([
      "EMERGENCY_CONTACTS",
      "EMERGENCY_PROFILE",
      "STUDENT_NAME",
      "STUDENT_PHOTO",
      "PARENT_PHONE",
      "PARENT_EMAIL",
      "CARD_VISIBILITY",
      "CARD_BLOCK",
      "CARD_REPLACEMENT",
      "NOTIFICATION_PREFS",
    ])
    .optional(),
  student_id: z.string().uuid().optional(),
});

// ─── Emergency Profiles ───────────────────────────────────────────────────────

/**
 * GET /monitoring/emergency-profiles
 */
export const emergencyProfileQuerySchema = pagination.extend({
  student_id:  z.string().uuid().optional(),
  visibility:  z.enum(["PUBLIC", "MINIMAL", "HIDDEN"]).optional(),
  blood_group: z
    .enum(["A_POS", "A_NEG", "B_POS", "B_NEG", "AB_POS", "AB_NEG", "O_POS", "O_NEG", "UNKNOWN"])
    .optional(),
});

// ─── Notifications ────────────────────────────────────────────────────────────

/**
 * GET /monitoring/notifications
 */
export const notificationQuerySchema = pagination.merge(dateRange).extend({
  type:   z
    .enum(["SCAN_ALERT", "SCAN_ANOMALY", "CARD_EXPIRING", "CARD_REVOKED", "CARD_REPLACED", "BILLING_ALERT", "DEVICE_LOGIN", "SYSTEM"])
    .optional(),
  status: z.enum(["QUEUED", "SENT", "FAILED", "SUPPRESSED"]).optional(),
});