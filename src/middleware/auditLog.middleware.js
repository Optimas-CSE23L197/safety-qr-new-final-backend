// =============================================================================
// auditLog.middleware.js — RESQID
// Automatic audit trail for every mutating authenticated request
// Writes to AuditLog model after response is sent — never blocks the request
//
// Why this matters:
//   The AuditLog model (actor_id, actor_type, action, entity, entity_id,
//   old_value, new_value) exists in the schema but nothing was writing to it
//   automatically. For a system handling children's emergency medical data,
//   a complete forensic trail is critical — both for DPDP Act 2023 compliance
//   and for incident investigation.
//
// Strategy:
//   - Runs on EVERY mutating request (POST, PUT, PATCH, DELETE)
//   - Infers entity/action from URL path + HTTP method
//   - Writes AFTER response is sent (res.on('finish')) — non-blocking
//   - Never fails the request — audit errors are logged but swallowed
//   - Read-only requests (GET) are NOT logged here (too noisy, use httpLogger)
//
// Schema: AuditLog { actor_id, actor_type, action, entity, entity_id,
//                    old_value, new_value, metadata, ip_address, user_agent }
// =============================================================================

import { prisma } from '#config/database/prisma.js';
import { extractIp } from '#utils/network/extractIp.js';
import { logger } from '#config/logger.js';
import { parseUserAgentSummary } from '#utils/network/userAgent.js';

// ─── Methods That Produce Audit Entries ──────────────────────────────────────

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Routes to skip — these are handled by dedicated audit logic in their handlers
// (e.g., login/logout write their own DeviceLoginLog + Session records)
const SKIP_PREFIXES = [
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/refresh',
  '/api/auth/otp',
  '/api/emergency', // public endpoint — no actor to log
  '/health',
];

// ─── Entity Inference — URL → entity name + ID ───────────────────────────────
// Maps URL segments to AuditLog entity names
// e.g. /api/school-admin/students/abc123 → { entity: "Student", entityId: 'abc123' }

const ENTITY_MAP = {
  students: 'Student',
  parents: 'ParentUser',
  schools: 'School',
  tokens: 'Token',
  orders: 'CardOrder',
  users: 'SchoolUser',
  settings: 'SchoolSettings',
  template: 'CardTemplate',
  subscriptions: 'Subscription',
  payments: 'Payment',
  invoices: 'Invoice',
  anomalies: 'ScanAnomaly',
  devices: 'ParentDevice',
  sessions: 'Session',
  webhooks: 'Webhook',
  flags: 'FeatureFlag',
  emergency: 'EmergencyProfile',
  contacts: 'EmergencyContact',
  visibility: 'CardVisibility',
};

// Maps HTTP method → action verb
const ACTION_MAP = {
  POST: 'CREATE',
  PUT: 'UPDATE',
  PATCH: 'UPDATE',
  DELETE: 'DELETE',
};

// ─── Actor Type Mapping ───────────────────────────────────────────────────────

const ACTOR_TYPE_MAP = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  SCHOOL_USER: 'SCHOOL_USER',
  PARENT_USER: 'PARENT_USER',
};

// ─── Core Middleware ──────────────────────────────────────────────────────────

/**
 * auditLog
 * Hooks into res.on('finish') — writes audit entry after response is sent.
 * Never delays or blocks the response.
 *
 * Must run AFTER authenticate so req.userId and req.role are populated.
 * Can be registered globally or per-router — both work.
 */
export function auditLog(req, res, next) {
  // Only log mutating methods
  if (!MUTATING_METHODS.has(req.method)) return next();

  // Skip certain routes
  if (SKIP_PREFIXES.some(p => req.path.startsWith(p))) return next();

  // Only log authenticated requests (must have actor)
  if (!req.userId || !req.role) return next();

  // Capture body snapshot BEFORE response — body may be modified by handlers
  // Shallow clone only — deep clone is too expensive on the hot path
  const requestBodySnapshot = req.body ? { ...req.body } : null;

  res.on('finish', () => {
    // Only write audit log for successful mutations (2xx responses)
    // Failed requests (4xx/5xx) are already logged by httpLogger + error middleware
    if (res.statusCode < 200 || res.statusCode >= 300) return;

    writeAuditLog(req, res, requestBodySnapshot).catch(err => {
      logger.error(
        { err: err.message, path: req.path, userId: req.userId },
        'auditLog: failed to write audit entry'
      );
    });
  });

  next();
}

// ─── Audit Writer ─────────────────────────────────────────────────────────────

async function writeAuditLog(req, _res, requestBody) {
  const { entity, entityId } = inferEntity(req);
  const action = ACTION_MAP[req.method] ?? req.method;
  const actorType = ACTOR_TYPE_MAP[req.role] ?? 'SYSTEM';
  const ip = extractIp(req);

  // Sanitize body before logging — strip sensitive fields
  const sanitizedBody = sanitizeForAudit(requestBody);

  await prisma.auditLog.create({
    data: {
      school_id: req.schoolId ?? null,
      actor_id: req.userId,
      actor_type: actorType,
      action: `${action}:${entity ?? 'UNKNOWN'}`,
      entity: entity ?? 'UNKNOWN',
      entity_id: entityId ?? 'UNKNOWN',
      // old_value populated by handlers that need before/after diffs
      // This middleware captures new_value from request body as a best-effort
      new_value: sanitizedBody,
      metadata: {
        method: req.method,
        path: req.path,
        requestId: req.id,
        deviceId: req.deviceId ?? null,
        sessionId: req.sessionId ?? null,
      },
      ip_address: ip,
      user_agent: parseUserAgentSummary(req),
    },
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * inferEntity
 * Parses URL path segments to determine entity name and ID
 * /api/school-admin/students/abc123/emergency → { entity: "Student", entityId: 'abc123' }
 */
function inferEntity(req) {
  // Strip query string and split path
  const segments = req.path
    .toLowerCase()
    .split('/')
    .filter(Boolean)
    .filter(s => !['api', 'v1', 'v2', 'super-admin', 'school-admin', 'parents'].includes(s));

  let entity = null;
  let entityId = null;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (ENTITY_MAP[seg]) {
      entity = ENTITY_MAP[seg];
      // Next segment is likely the ID (UUID format)
      const next = segments[i + 1];
      if (next && isUuidLike(next)) {
        entityId = next;
      }
    }
  }

  // Fallback: use req.params if entity couldn't be inferred from path
  if (!entityId) {
    entityId =
      req.params?.id ??
      req.params?.studentId ??
      req.params?.tokenId ??
      req.params?.schoolId ??
      req.params?.orderId ??
      null;
  }

  return { entity, entityId };
}

/**
 * sanitizeForAudit
 * Strip sensitive fields from request body before writing to audit log
 */
const AUDIT_SENSITIVE_KEYS = new Set([
  'password',
  'password_hash',
  'otp',
  'otp_hash',
  'token_hash',
  'refresh_token',
  'dob_encrypted',
  'phone_encrypted',
  'doctor_phone_encrypted',
  'secret',
  'private_key',
]);

function sanitizeForAudit(obj) {
  if (!obj || typeof obj !== 'object') return obj;

  const clean = {};
  for (const [key, value] of Object.entries(obj)) {
    if (AUDIT_SENSITIVE_KEYS.has(key.toLowerCase())) {
      clean[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      clean[key] = sanitizeForAudit(value);
    } else {
      clean[key] = value;
    }
  }
  return clean;
}

function isUuidLike(str) {
  return /^[0-9a-f-]{36}$/i.test(str) || /^[0-9a-f]{24}$/i.test(str);
}
