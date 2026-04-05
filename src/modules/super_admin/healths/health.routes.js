// =============================================================================
// health.routes.js — RESQID Super Admin
// All routes require SUPER_ADMIN — no school admin access to health monitor.
// =============================================================================

import { Router } from 'express';
import { authenticate }     from '#middleware/auth.middleware.js';
import { requireSuperAdmin } from '#middleware/rbac.middleware.js';
import {
  getFullHealth,
  getServices,
  getIncidents,
  getIncident,
  createNewIncident,
  updateExistingIncident,
} from './health.controller.js';

const router = Router();

// Every route in this file requires authentication + SUPER_ADMIN role.
// Applied once here so individual handlers stay clean.
router.use(authenticate, requireSuperAdmin);

// ─── System health ───────────────────────────────────────────────────────────

/**
 * GET /api/super-admin/health
 * Full health snapshot: overall status + all services + all incidents.
 * This is what the HealthMonitor page loads on mount and on Refresh click.
 *
 * Response shape:
 * {
 *   overall_status: 'HEALTHY' | 'DEGRADED' | 'DOWN',
 *   healthy_count: number,
 *   degraded_count: number,
 *   down_count: number,
 *   active_incidents: number,
 *   dlq_unresolved: number,
 *   stalled_pipelines: number,
 *   services: ServiceStatus[],
 *   incidents: Incident[],
 *   checked_at: ISO string
 * }
 */
router.get('/', getFullHealth);

/**
 * GET /api/super-admin/health/services
 * Service statuses only — lighter alternative to the full health endpoint.
 * Good for a background polling interval without re-fetching incidents.
 *
 * Response shape:
 * {
 *   overall_status: 'HEALTHY' | 'DEGRADED' | 'DOWN',
 *   services: ServiceStatus[]
 * }
 *
 * ServiceStatus shape:
 * {
 *   id: string,
 *   name: string,
 *   region: string,
 *   status: 'HEALTHY' | 'DEGRADED' | 'DOWN',
 *   latency: number | null,   // ms
 *   uptime: number            // rolling % from last 200 checks
 * }
 */
router.get('/services', getServices);

// ─── Incidents ───────────────────────────────────────────────────────────────

/**
 * GET /api/super-admin/health/incidents
 * List incidents with optional filters.
 *
 * Query params:
 *   ?status=ALL|INVESTIGATING|IDENTIFIED|MONITORING|RESOLVED (default: ALL)
 *   ?active_only=true  — excludes RESOLVED incidents
 *
 * Response: Incident[]
 * Incident shape:
 * {
 *   id, title, severity, affected_services[], message,
 *   status: 'INVESTIGATING'|'IDENTIFIED'|'MONITORING'|'RESOLVED',
 *   created_by, started_at, updated_at, resolved_at?,
 *   updates: [{ at, status, message, by }]
 * }
 */
router.get('/incidents', getIncidents);

/**
 * POST /api/super-admin/health/incidents
 * Create a new incident. status is always INVESTIGATING on creation.
 *
 * Body:
 * {
 *   title: string (5–200 chars),
 *   severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL',
 *   affected_services: string[] (min 1, from: api|db|redis|qr|notif|sms|storage|email),
 *   message: string (10–2000 chars)
 * }
 */
router.post('/incidents', createNewIncident);

/**
 * GET /api/super-admin/health/incidents/:id
 * Single incident detail including full audit trail (updates[]).
 */
router.get('/incidents/:id', getIncident);

/**
 * PATCH /api/super-admin/health/incidents/:id
 * Update incident status, severity, or add a message update.
 * At least one field required.
 *
 * Body (all optional):
 * {
 *   status?: 'INVESTIGATING'|'IDENTIFIED'|'MONITORING'|'RESOLVED',
 *   severity?: 'LOW'|'MEDIUM'|'HIGH'|'CRITICAL',
 *   message?: string (10–2000 chars)
 * }
 */
router.patch('/incidents/:id', updateExistingIncident);

export default router;