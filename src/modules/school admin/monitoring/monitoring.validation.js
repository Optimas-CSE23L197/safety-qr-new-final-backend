// =============================================================================
// monitoring.validation.js — RESQID School Admin › Scan Monitoring
// Zod schemas — strict() on all body schemas, .transform() for normalisation
// =============================================================================

import { z } from "zod";

// ─── Shared ───────────────────────────────────────────────────────────────────

export const uuidParam = z.object({
  id: z.string().uuid("Invalid UUID"),
});

const paginationQuery = z.object({
  page:    z.coerce.number().int().min(1).default(1),
  limit:   z.coerce.number().int().min(1).max(100).default(25),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
});

const dateRangeQuery = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to:   z.string().datetime({ offset: true }).optional(),
});

// ─── Overview ─────────────────────────────────────────────────────────────────

/**
 * GET /monitoring/overview
 * No extra params — returns stats + trend + breakdown in one shot
 */
export const overviewQuerySchema = z.object({}).optional();

// ─── Scan Logs ────────────────────────────────────────────────────────────────

/**
 * GET /monitoring/scan-logs
 */
export const scanLogQuerySchema = paginationQuery
  .merge(dateRangeQuery)
  .extend({
    result: z
      .enum(["SUCCESS", "INVALID", "REVOKED", "EXPIRED", "INACTIVE", "RATE_LIMITED", "ERROR"])
      .optional(),
    // "true" = student linked to token, "false" = token has no student
    student_known: z
      .enum(["true", "false"])
      .transform((v) => v === "true")
      .optional(),
    token_id:   z.string().uuid().optional(),
    student_id: z.string().uuid().optional(),
  });

// ─── Anomalies ────────────────────────────────────────────────────────────────

/**
 * GET /monitoring/anomalies
 */
export const anomalyQuerySchema = paginationQuery
  .merge(dateRangeQuery)
  .extend({
    severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
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
    // "true" = show resolved, "false" = show unresolved, omit = show all
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

// ─── Multi-Device ─────────────────────────────────────────────────────────────

/**
 * GET /monitoring/multi-device
 * Tokens scanned from more than min_devices distinct device_hashes
 */
export const multiDeviceQuerySchema = paginationQuery
  .merge(dateRangeQuery)
  .extend({
    min_devices: z.coerce.number().int().min(2).default(2),
  });

// ─── Notifications ────────────────────────────────────────────────────────────

/**
 * GET /monitoring/notifications
 */
export const notificationQuerySchema = paginationQuery
  .merge(dateRangeQuery)
  .extend({
    type: z
      .enum([
        "SCAN_ALERT",
        "SCAN_ANOMALY",
        "CARD_REVOKED",
        "CARD_REPLACED",
        "CARD_EXPIRING",
        "DEVICE_LOGIN",
        "SYSTEM",
        "BILLING_ALERT",
      ])
      .optional(),
    status: z.enum(["QUEUED", "SENT", "FAILED", "SUPPRESSED"]).optional(),
  });