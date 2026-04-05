// =============================================================================
// health.controller.js — RESQID Super Admin
// HTTP layer only. No business logic. All heavy lifting is in health.service.js.
// Every handler is wrapped in asyncHandler — errors auto-forward to middleware.
// =============================================================================

import { asyncHandler } from '#shared/response/asyncHandler.js';
import { ApiResponse }  from '#shared/response/ApiResponse.js';
import { ApiError }     from '#shared/response/ApiError.js';
import {
  getSystemHealth,
  getAllServiceStatuses,
  listIncidents,
  getIncidentById,
  createIncident,
  updateIncident,
} from './health.service.js';
import {
  createIncidentSchema,
  updateIncidentSchema,
  listIncidentsQuerySchema,
} from './health.validation.js';

// ─── GET /api/super-admin/health ─────────────────────────────────────────────
/**
 * Full system health snapshot.
 * Frontend "Refresh" button hits this — returns everything in one call.
 * Shape matches HealthMonitor component exactly (overall_status, services, incidents).
 */
export const getFullHealth = asyncHandler(async (req, res) => {
  const health = await getSystemHealth();
  return ApiResponse.ok(res, health, 'System health retrieved');
});

// ─── GET /api/super-admin/health/services ────────────────────────────────────
/**
 * Service statuses only — lighter than the full health endpoint.
 * Useful for polling service list independently.
 */
export const getServices = asyncHandler(async (req, res) => {
  const services = await getAllServiceStatuses();

  const downCount     = services.filter(s => s.status === 'DOWN').length;
  const degradedCount = services.filter(s => s.status === 'DEGRADED').length;
  const overallStatus = downCount > 0
    ? 'DOWN'
    : degradedCount > 0
    ? 'DEGRADED'
    : 'HEALTHY';

  return ApiResponse.ok(res, { services, overall_status: overallStatus }, 'Service statuses retrieved');
});

// ─── GET /api/super-admin/health/incidents ───────────────────────────────────
/**
 * List incidents.
 * Query params:
 *   ?status=INVESTIGATING|IDENTIFIED|MONITORING|RESOLVED|ALL (default: ALL)
 *   ?active_only=true   (excludes RESOLVED)
 */
export const getIncidents = asyncHandler(async (req, res) => {
  const parsed = listIncidentsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw ApiError.validationError('Invalid query parameters', parsed.error.flatten().fieldErrors);
  }

  const incidents = await listIncidents(parsed.data);
  return ApiResponse.ok(res, incidents, 'Incidents retrieved');
});

// ─── GET /api/super-admin/health/incidents/:id ───────────────────────────────
/**
 * Single incident detail (includes full updates audit trail).
 */
export const getIncident = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const incident = await getIncidentById(id);
  if (!incident) throw ApiError.notFound('Incident');
  return ApiResponse.ok(res, incident, 'Incident retrieved');
});

// ─── POST /api/super-admin/health/incidents ──────────────────────────────────
/**
 * Create a new incident.
 * Body: { title, severity, affected_services[], message }
 * created_by is auto-populated from req.userId (authenticated super admin).
 */
export const createNewIncident = asyncHandler(async (req, res) => {
  const parsed = createIncidentSchema.safeParse(req.body);
  if (!parsed.success) {
    throw ApiError.validationError('Incident validation failed', parsed.error.flatten().fieldErrors);
  }

  const incident = await createIncident({
    ...parsed.data,
    created_by: req.userId,
  });

  return ApiResponse.created(res, incident, 'Incident created');
});

// ─── PATCH /api/super-admin/health/incidents/:id ─────────────────────────────
/**
 * Update incident status, severity, or add an update message.
 * Body (all optional, at least one required):
 *   { status?, severity?, message? }
 * updated_by is auto-populated from req.userId.
 */
export const updateExistingIncident = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const parsed = updateIncidentSchema.safeParse(req.body);
  if (!parsed.success) {
    throw ApiError.validationError('Update validation failed', parsed.error.flatten().fieldErrors);
  }

  const incident = await updateIncident(id, {
    ...parsed.data,
    updated_by: req.userId,
  });

  if (!incident) throw ApiError.notFound('Incident');

  return ApiResponse.ok(res, incident, 'Incident updated');
});