// =============================================================================
// notification.routes.js — RESQID Super Admin
// All routes: SUPER_ADMIN only, authenticate + requireSuperAdmin guards
// =============================================================================

import { Router } from 'express';
import { authenticate }     from '#middleware/auth.middleware.js';
import { requireSuperAdmin } from '#middleware/rbac.middleware.js';
import * as Controller from './notification.controller.js';

const router = Router();

// Apply auth + role guard to every route in this file
router.use(authenticate, requireSuperAdmin);

// ─────────────────────────────────────────────────────────────────────────────
// NOTE: /stats MUST be defined before /:id
// Express matches routes top-down — if /:id comes first, the literal
// string "stats" would be captured as an id param, failing UUID validation.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/super-admin/notifications/stats
 *
 * Query params (all optional):
 *   date_range  "24h" | "7d" | "30d" | "this_month" | "custom"  (default: "30d")
 *   date_from   ISO date — only used when date_range = "custom"
 *   date_to     ISO date — only used when date_range = "custom"
 *
 * Response:
 *   {
 *     total, total_sent, total_failed, total_queued, total_suppressed,
 *     delivery_rate,   // percentage (e.g. 98.7) or null if no data
 *     by_channel,      // { PUSH: n, EMAIL: n, SMS: n, ... }
 *     by_type          // [{ type, count }, ...]  top 10
 *   }
 *
 * Frontend usage:
 *   Stat card 1: "Total Notifications" → data.total
 *   Stat card 2: "Avg. Delivery Rate"  → data.delivery_rate + "%"
 *   Stat card 3: "Total Failed"        → data.total_failed
 */
router.get('/stats', Controller.getStats);

/**
 * GET /api/super-admin/notifications
 *
 * Query params:
 *   page        number   (default: 1)
 *   limit       number   (default: 10, max: 100)
 *   school_id   uuid     — filter by school
 *   type        string   — e.g. "SCAN_ALERT", "BILLING_ALERT"
 *   channel     enum     — PUSH | EMAIL | SMS | WHATSAPP
 *   status      enum     — SENT | FAILED | QUEUED | SUPPRESSED
 *   date_range  enum     — 24h | 7d | 30d | this_month | custom
 *   date_from   date     — ISO date (custom range only)
 *   date_to     date     — ISO date (custom range only)
 *
 * Response:
 *   { data: Notification[], meta: { total, page, limit, totalPages, ... } }
 *
 * Frontend usage:
 *   Notification Logs table — all filter dropdowns map to these params.
 *   The "School" dropdown in the frontend sends school_id (UUID), not name.
 *   (Frontend must fetch schools list separately and map name → id.)
 */
router.get('/', Controller.listNotifications);

/**
 * GET /api/super-admin/notifications/:id
 *
 * Params:
 *   id  — UUID of the notification
 *
 * Response:
 *   Full notification object including payload JSON
 *
 * Frontend usage:
 *   "View Payload" button in the table row → opens PayloadModal
 *   which renders the full JSON payload and error message.
 */
router.get('/:id', Controller.getNotificationById);

export default router;