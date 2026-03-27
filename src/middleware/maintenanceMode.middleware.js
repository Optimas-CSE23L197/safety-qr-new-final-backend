// =============================================================================
// maintenanceMode.middleware.js — RESQID
// Global maintenance gate — checks FeatureFlag DB model for maintenance_mode
// Returns 503 with JSON before ANY request processing when active
//
// Why this matters:
//   Without this, deploying during a maintenance window means live requests
//   hit the DB mid-migration, causing partial writes, corrupted state, and
//   confusing errors. This middleware gates all traffic cleanly with a
//   proper 503 + Retry-After so mobile apps and dashboards handle it gracefully.
//
// Schema: FeatureFlag { key: "maintenance_mode", enabled: Boolean }
// Redis cache: "flag:maintenance_mode" (30 second TTL — fast to enable/disable)
//
// Bypass:
//   Super admins can bypass using X-Maintenance-Bypass: <BYPASS_SECRET>
//   This allows Anthropic ops to check system health during maintenance.
//
// To enable:  UPDATE "FeatureFlag" SET enabled=true WHERE key="maintenance_mode"
//             Then flush Redis key: DEL flag:maintenance_mode
// To disable: UPDATE "FeatureFlag' SET enabled=false WHERE key='maintenance_mode'
//             Then flush Redis key: DEL flag:maintenance_mode
// =============================================================================

import { prisma } from '#config/prisma.js';
import { redis } from '#config/redis.js';
import { ENV } from '#config/env.js';
import { logger } from '#config/logger.js';

const FLAG_KEY = 'maintenance_mode';
const CACHE_KEY = `flag:${FLAG_KEY}`;
const CACHE_TTL = 30; // 30 seconds — short so enable/disable is near-instant
const BYPASS_HEADER = 'x-maintenance-bypass';

// Routes that always work even during maintenance
// Health check must stay alive so load balancers know the server is up
const ALWAYS_ALLOWED = new Set(['/health', '/api/health', '/api/status']);

// ─── Core Middleware ──────────────────────────────────────────────────────────

/**
 * maintenanceMode
 * Register this as the FIRST middleware in app.js, before everything else.
 * If maintenance_mode flag is enabled → 503 all non-bypass requests immediately.
 */
export async function maintenanceMode(req, res, next) {
  // Always allow health check routes
  if (ALWAYS_ALLOWED.has(req.path)) return next();

  let isMaintenanceEnabled = false;

  try {
    isMaintenanceEnabled = await checkMaintenanceFlag();
  } catch (err) {
    // If we can't check the flag (Redis + DB both down), fail open —
    // it's better to serve requests than to 503 everything due to a
    // monitoring failure. Log at error level for ops visibility.
    logger.error({ err: err.message }, 'maintenanceMode: could not check flag — failing open');
    return next();
  }

  if (!isMaintenanceEnabled) return next();

  // Maintenance is active — check for bypass header (ops only)
  const bypassSecret = req.headers[BYPASS_HEADER];
  if (ENV.MAINTENANCE_BYPASS_SECRET && bypassSecret === ENV.MAINTENANCE_BYPASS_SECRET) {
    logger.warn({ ip: req.ip, path: req.path }, 'maintenanceMode: bypass used');
    return next();
  }

  // Maintenance window — estimate 15 min retry
  res.setHeader('Retry-After', '900');
  return res.status(503).json({
    success: false,
    message: 'RESQID is currently undergoing scheduled maintenance. We will be back shortly.',
    retryAfter: 900,
    requestId: req.id ?? 'unknown',
    timestamp: new Date().toISOString(),
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function checkMaintenanceFlag() {
  // Redis first — fast path
  const cached = await redis.get(CACHE_KEY);
  if (cached !== null) {
    return cached === '1';
  }

  // DB fallback
  const flag = await prisma.featureFlag.findUnique({
    where: { key: FLAG_KEY },
    select: { enabled: true },
  });

  const enabled = flag?.enabled ?? false;

  // Cache result — 30 second TTL so ops can toggle quickly
  await redis.setex(CACHE_KEY, CACHE_TTL, enabled ? '1' : '0');

  return enabled;
}

/**
 * flushMaintenanceCache
 * Call this after toggling the flag in DB so the new value is picked up
 * within milliseconds rather than waiting for the 30s TTL to expire.
 */
export async function flushMaintenanceCache() {
  await redis.del(CACHE_KEY);
}
