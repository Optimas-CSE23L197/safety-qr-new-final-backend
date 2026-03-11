// =============================================================================
// auditLogger.js — RESQID
// Structured audit trail — every data mutation must be logged here
// Writes to AuditLog table asynchronously — never blocks the request
//
// When to use:
//   - Parent updates emergency profile → log it
//   - Super admin generates tokens → log it
//   - School admin deactivates student → log it
//   - Any DELETE → always log with full old value
// =============================================================================

import { prisma } from "../../config/prisma.js";
import { logger } from "../../config/logger.js";

/**
 * @typedef {Object} AuditEntry
 * @property {string}   actorId    - User ID performing the action
 * @property {'SUPER_ADMIN'|'SCHOOL_USER'|'PARENT_USER'|'SYSTEM'} actorType
 * @property {string}   action     - Verb: 'CREATE', 'UPDATE', 'DELETE', 'REVOKE', etc.
 * @property {string}   entity     - Table/model name: 'Student', 'Token', 'EmergencyProfile'
 * @property {string}   entityId   - Primary key of affected record
 * @property {*}        [oldValue] - Previous state (for UPDATE/DELETE)
 * @property {*}        [newValue] - New state (for CREATE/UPDATE)
 * @property {string}   [schoolId] - For tenant-scoped entries
 * @property {string}   [ip]       - IP from request
 * @property {string}   [ua]       - User agent from request
 */

// ─── Core Writer ──────────────────────────────────────────────────────────────

/**
 * writeAuditLog(entry)
 * Fire-and-forget — never throws, never blocks the caller
 * If DB write fails → falls back to logger.error (still traceable)
 */
export function writeAuditLog(entry) {
  _writeAsync(entry).catch((err) => {
    // DB audit write failed — log to structured logger as fallback
    logger.error(
      {
        type: "audit_log_failure",
        entry,
        err: err.message,
      },
      "Audit log DB write failed — logged here as fallback",
    );
  });
}

async function _writeAsync(entry) {
  await prisma.auditLog.create({
    data: {
      actor_id: entry.actorId,
      actor_type: entry.actorType,
      action: entry.action,
      entity: entry.entity,
      entity_id: entry.entityId,
      old_value: sanitizeForLog(entry.oldValue),
      new_value: sanitizeForLog(entry.newValue),
      school_id: entry.schoolId ?? null,
      ip_address: entry.ip ?? null,
      user_agent: entry.ua ?? null,
      metadata: entry.metadata ?? null,
    },
  });
}

// ─── Context Builder ──────────────────────────────────────────────────────────

/**
 * auditCtx(req)
 * Extract audit context from Express request — use at top of controller
 *
 * @example
 * const ctx = auditCtx(req)
 * writeAuditLog({ ...ctx, action: 'UPDATE', entity: 'Student', entityId: id, newValue: body })
 */
export function auditCtx(req) {
  return {
    actorId: req.userId ?? "SYSTEM",
    actorType: req.role ?? "SYSTEM",
    schoolId: req.schoolId ?? null,
    ip: req.ip ?? null,
    ua: req.headers?.["user-agent"] ?? null,
  };
}

// ─── Action Helpers ───────────────────────────────────────────────────────────
// Pre-built for the most common RESQID audit events

export const AuditAction = {
  // General CRUD
  CREATE: "CREATE",
  UPDATE: "UPDATE",
  DELETE: "DELETE",

  // Auth
  LOGIN: "LOGIN",
  LOGOUT: "LOGOUT",
  REFRESH: "TOKEN_REFRESH",
  OTP_SENT: "OTP_SENT",
  OTP_VERIFY: "OTP_VERIFIED",

  // Token/QR
  TOKEN_GENERATE: "TOKEN_GENERATE",
  TOKEN_REVOKE: "TOKEN_REVOKE",
  TOKEN_ASSIGN: "TOKEN_ASSIGN",
  QR_GENERATE: "QR_GENERATE",

  // Card
  CARD_BLOCK: "CARD_BLOCK",
  CARD_UNBLOCK: "CARD_UNBLOCK",
  CARD_RENEW: "CARD_RENEW",
  VISIBILITY_CHANGE: "VISIBILITY_CHANGE",

  // Emergency profile
  PROFILE_UPDATE: "PROFILE_UPDATE",
  CONTACT_ADD: "CONTACT_ADD",
  CONTACT_UPDATE: "CONTACT_UPDATE",
  CONTACT_DELETE: "CONTACT_DELETE",

  // School
  SCHOOL_CREATE: "SCHOOL_CREATE",
  SCHOOL_SUSPEND: "SCHOOL_SUSPEND",

  // Security
  DEVICE_REVOKE: "DEVICE_REVOKE",
  SESSION_REVOKE: "SESSION_REVOKE",
  ACCOUNT_SUSPEND: "ACCOUNT_SUSPEND",

  // Scan
  ANOMALY_RESOLVE: "ANOMALY_RESOLVE",
};

// ─── Sensitive Field Sanitizer ────────────────────────────────────────────────

const SENSITIVE_KEYS = new Set([
  "password",
  "password_hash",
  "otp",
  "otp_hash",
  "token_hash",
  "refresh_token_hash",
  "phone_encrypted",
  "dob_encrypted",
  "doctor_phone_encrypted",
  "secret",
  "key",
]);

function sanitizeForLog(value) {
  if (value == null) return null;
  if (typeof value !== "object") return value;
  return _sanitizeDeep(value);
}

function _sanitizeDeep(obj) {
  if (Array.isArray(obj)) return obj.map(_sanitizeDeep);
  if (typeof obj !== "object" || obj === null) return obj;

  const clean = {};
  for (const [k, v] of Object.entries(obj)) {
    clean[k] = SENSITIVE_KEYS.has(k.toLowerCase())
      ? "[REDACTED]"
      : _sanitizeDeep(v);
  }
  return clean;
}
