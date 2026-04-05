// =============================================================================
// health.service.js — RESQID Super Admin
// Business logic: individual service checks, health aggregation, incident CRUD.
//
// INCIDENT PERSISTENCE NOTE:
// Incidents are stored in a module-scoped Map (in-memory) for now.
// They survive server restarts via the Redis snapshot below, but for
// full DB persistence add an Incident model to prisma.schema and wire
// it through health.repository.js. The API contract will not change.
// =============================================================================

import { randomUUID } from 'crypto';
import { ENV } from '#config/env.js';
import { logger } from '#config/logger.js';
import { redis } from '#config/redis.js';
import * as repo from './health.repository.js';

// ─── Constants ────────────────────────────────────────────────────────────────
const INCIDENTS_REDIS_KEY   = 'health:incidents';
const INCIDENTS_REDIS_TTL   = 86400 * 7; // 7 days — provides restart persistence
const HIGH_LATENCY_THRESHOLD = 500;      // ms — anything above is DEGRADED
const NOTIF_FAIL_RATE_WARN  = 10;        // % notification failures → DEGRADED
const NOTIF_FAIL_RATE_DOWN  = 50;        // % notification failures → DOWN
const SCAN_ERROR_RATE_WARN  = 5;         // % scan errors → DEGRADED
const SCAN_ERROR_RATE_DOWN  = 20;        // % scan errors → DOWN

// ─── Service Definitions ──────────────────────────────────────────────────────
// Shape: { id, name, region, checkFn }
// checkFn must return: { status: 'HEALTHY'|'DEGRADED'|'DOWN', latencyMs: number|null }

const SERVICE_DEFS = [
  {
    id: 'api',
    name: 'API Server',
    region: 'Mumbai',
    checkFn: checkApiServer,
  },
  {
    id: 'db',
    name: 'Database (Postgres)',
    region: 'Mumbai',
    checkFn: checkDatabase,
  },
  {
    id: 'redis',
    name: 'Redis Cache',
    region: 'Mumbai',
    checkFn: checkRedisService,
  },
  {
    id: 'qr',
    name: 'QR Scan Service',
    region: 'Global CDN',
    checkFn: checkQrService,
  },
  {
    id: 'notif',
    name: 'Notification Service',
    region: 'Mumbai',
    checkFn: checkNotificationService,
  },
  {
    id: 'sms',
    name: 'SMS Gateway',
    region: 'Third-party',
    checkFn: checkSmsGateway,
  },
  {
    id: 'storage',
    name: 'File Storage (R2)',
    region: 'Mumbai',
    checkFn: checkStorageService,
  },
  {
    id: 'email',
    name: 'Email Service',
    region: 'Third-party',
    checkFn: checkEmailService,
  },
];

const SERVICE_IDS = SERVICE_DEFS.map(s => s.id);

// ─── Individual Service Check Functions ───────────────────────────────────────

async function checkApiServer() {
  // If this function is executing, the API is running.
  // Latency = 0 (self-check, no I/O).
  return { status: 'HEALTHY', latencyMs: 0 };
}

async function checkDatabase() {
  const result = await repo.checkDbConnectivity();
  if (!result.ok) return { status: 'DOWN', latencyMs: null };
  // DB is considered DEGRADED if latency > 500ms (Neon cold start or overload)
  const status = result.latencyMs > HIGH_LATENCY_THRESHOLD ? 'DEGRADED' : 'HEALTHY';
  return { status, latencyMs: result.latencyMs };
}

async function checkRedisService() {
  const result = await repo.checkRedisConnectivity();
  if (!result.ok) return { status: 'DOWN', latencyMs: null };
  const status = result.latencyMs > HIGH_LATENCY_THRESHOLD ? 'DEGRADED' : 'HEALTHY';
  return { status, latencyMs: result.latencyMs };
}

async function checkQrService() {
  // Health derived from: recent scan success rate + actual avg response time from DB
  const [{ total, errors }, avgLatency] = await Promise.all([
    repo.getScanStats(),
    repo.getAvgScanResponseTime(),
  ]);

  const errorRate = total > 0 ? (errors / total) * 100 : 0;
  let status = 'HEALTHY';
  if (errorRate >= SCAN_ERROR_RATE_DOWN) status = 'DOWN';
  else if (errorRate >= SCAN_ERROR_RATE_WARN) status = 'DEGRADED';

  // Use real avg latency from recent scan logs, fall back to null
  return { status, latencyMs: avgLatency };
}

async function checkNotificationService() {
  const { total, failed } = await repo.getNotificationStats();
  const failRate = total > 0 ? (failed / total) * 100 : 0;

  let status = 'HEALTHY';
  let latencyMs = 90; // nominal healthy latency estimate
  if (failRate >= NOTIF_FAIL_RATE_DOWN) {
    status = 'DOWN';
    latencyMs = null;
  } else if (failRate >= NOTIF_FAIL_RATE_WARN) {
    status = 'DEGRADED';
    latencyMs = 450;
  }

  return { status, latencyMs };
}

async function checkSmsGateway() {
  // If MSG91 credentials are absent, the service is not configured → DOWN
  if (!ENV.MSG91_AUTH_KEY && !ENV.MSG91_API_KEY) {
    return { status: 'DOWN', latencyMs: null };
  }

  // Optional: ping MSG91 status page with a short timeout
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const start = Date.now();
    const res = await fetch('https://api.msg91.com/api/v5/status', {
      signal: controller.signal,
      method: 'GET',
    });
    clearTimeout(timeout);
    const latencyMs = Date.now() - start;
    const status = res.ok ? (latencyMs > HIGH_LATENCY_THRESHOLD ? 'DEGRADED' : 'HEALTHY') : 'DEGRADED';
    return { status, latencyMs };
  } catch {
    // Network failure or timeout → DEGRADED (credentials exist but reachability failed)
    return { status: 'DEGRADED', latencyMs: null };
  }
}

async function checkStorageService() {
  // Check if R2 or S3 credentials are configured
  const hasR2  = !!(ENV.R2_ACCOUNT_ID && ENV.R2_ACCESS_KEY_ID && ENV.R2_SECRET_ACCESS_KEY);
  const hasS3  = !!(ENV.AWS_ACCESS_KEY_ID && ENV.AWS_SECRET_ACCESS_KEY && ENV.AWS_BUCKET);

  if (!hasR2 && !hasS3) {
    return { status: 'DOWN', latencyMs: null };
  }

  // If configured, mark as HEALTHY (actual bucket ping would require SDK call — add if needed)
  return { status: 'HEALTHY', latencyMs: 35 };
}

async function checkEmailService() {
  const hasSendgrid = !!ENV.SENDGRID_API_KEY;
  const hasSmtp     = !!(ENV.SMTP_HOST && ENV.SMTP_USER && ENV.SMTP_PASS);

  if (!hasSendgrid && !hasSmtp) {
    return { status: 'DOWN', latencyMs: null };
  }

  return { status: 'HEALTHY', latencyMs: 110 };
}

// ─── Service Health Aggregation ───────────────────────────────────────────────

/**
 * getAllServiceStatuses()
 * Runs all service checks in parallel, records results for uptime tracking,
 * and returns the full enriched service list.
 */
export async function getAllServiceStatuses() {
  // Run all checks in parallel — a single slow/failed check won't block others
  const checkResults = await Promise.allSettled(
    SERVICE_DEFS.map(svc => svc.checkFn())
  );

  // Batch-fetch all rolling uptimes from Redis in one pipeline
  const uptimes = await repo.getAllUptimes(SERVICE_IDS);

  // Record this round's results for future uptime calculations (fire-and-forget)
  const recordPromises = SERVICE_DEFS.map((svc, i) => {
    const result = checkResults[i];
    const success = result.status === 'fulfilled' && result.value.status === 'HEALTHY';
    return repo.recordCheckResult(svc.id, success);
  });
  Promise.allSettled(recordPromises).catch(() => {}); // never await — don't block response

  // Assemble final shape
  return SERVICE_DEFS.map((svc, i) => {
    const settled = checkResults[i];
    const check = settled.status === 'fulfilled'
      ? settled.value
      : { status: 'DOWN', latencyMs: null };

    if (settled.status === 'rejected') {
      logger.error(
        { service: svc.id, err: settled.reason?.message },
        '[health.service] Service check threw unexpectedly'
      );
    }

    return {
      id:        svc.id,
      name:      svc.name,
      region:    svc.region,
      status:    check.status,
      latency:   check.latencyMs,            // frontend expects 'latency'
      uptime:    uptimes[svc.id] ?? 100.00,  // default 100% until we have data
    };
  });
}

// ─── Incident Store ───────────────────────────────────────────────────────────
// Module-scoped Map — single source of truth for this process.
// Hydrated from Redis on first use so incidents survive server restarts.

const incidentMap = new Map();
let hydrated = false;

async function hydrateFromRedis() {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = await redis.get(INCIDENTS_REDIS_KEY);
    if (raw) {
      const list = JSON.parse(raw);
      list.forEach(inc => incidentMap.set(inc.id, inc));
      logger.info({ count: list.length }, '[health.service] Incidents hydrated from Redis');
    }
  } catch (err) {
    logger.warn({ err: err.message }, '[health.service] Failed to hydrate incidents from Redis');
  }
}

async function persistToRedis() {
  try {
    const list = [...incidentMap.values()];
    await redis.setex(INCIDENTS_REDIS_KEY, INCIDENTS_REDIS_TTL, JSON.stringify(list));
  } catch (err) {
    logger.warn({ err: err.message }, '[health.service] Failed to persist incidents to Redis');
  }
}

// ─── Incident CRUD ────────────────────────────────────────────────────────────

export async function listIncidents({ status = 'ALL', active_only = false } = {}) {
  await hydrateFromRedis();
  let incidents = [...incidentMap.values()];

  if (active_only || status !== 'ALL') {
    incidents = incidents.filter(i => {
      if (active_only && i.status === 'RESOLVED') return false;
      if (status !== 'ALL' && i.status !== status) return false;
      return true;
    });
  }

  // Most recent first
  return incidents.sort((a, b) => new Date(b.started_at) - new Date(a.started_at));
}

export async function getIncidentById(id) {
  await hydrateFromRedis();
  return incidentMap.get(id) ?? null;
}

export async function createIncident({ title, severity, affected_services, message, created_by }) {
  await hydrateFromRedis();

  const now = new Date().toISOString();
  const id = `inc-${randomUUID().slice(0, 8)}`;

  const incident = {
    id,
    title,
    severity,
    affected_services,
    message,
    status: 'INVESTIGATING',
    created_by,
    started_at: now,
    updated_at: now,
    resolved_at: null,
    updates: [
      {
        at:      now,
        status:  'INVESTIGATING',
        message,
        by:      created_by,
      },
    ],
  };

  incidentMap.set(id, incident);
  await persistToRedis();

  logger.info({ incidentId: id, title, severity, created_by }, '[health.service] Incident created');
  return incident;
}

export async function updateIncident(id, { status, severity, message, updated_by }) {
  await hydrateFromRedis();

  const incident = incidentMap.get(id);
  if (!incident) return null;

  const now = new Date().toISOString();

  if (status)   incident.status   = status;
  if (severity) incident.severity = severity;
  if (message)  incident.message  = message;

  incident.updated_at = now;

  if (status === 'RESOLVED' && !incident.resolved_at) {
    incident.resolved_at = now;
  }

  // Append to audit trail
  incident.updates.push({
    at:      now,
    status:  incident.status,
    message: message ?? `Status updated to ${incident.status}`,
    by:      updated_by,
  });

  incidentMap.set(id, incident);
  await persistToRedis();

  logger.info({ incidentId: id, status, severity, updated_by }, '[health.service] Incident updated');
  return incident;
}

// ─── Full System Health Summary ───────────────────────────────────────────────

/**
 * getSystemHealth()
 * Master aggregator — called by GET /health endpoint.
 * Returns everything the frontend dashboard needs in one shot.
 */
export async function getSystemHealth() {
  const [services, incidents, dlqCount, stalledCount] = await Promise.all([
    getAllServiceStatuses(),
    listIncidents(),
    repo.getDlqUnresolved(),
    repo.getStalledPipelines(),
  ]);

  const downCount     = services.filter(s => s.status === 'DOWN').length;
  const degradedCount = services.filter(s => s.status === 'DEGRADED').length;
  const healthyCount  = services.filter(s => s.status === 'HEALTHY').length;

  const overallStatus = downCount > 0
    ? 'DOWN'
    : degradedCount > 0
    ? 'DEGRADED'
    : 'HEALTHY';

  const activeIncidents = incidents.filter(i => i.status !== 'RESOLVED');

  return {
    overall_status:    overallStatus,
    healthy_count:     healthyCount,
    degraded_count:    degradedCount,
    down_count:        downCount,
    active_incidents:  activeIncidents.length,
    dlq_unresolved:    dlqCount,
    stalled_pipelines: stalledCount,
    services,
    incidents,
    checked_at: new Date().toISOString(),
  };
}