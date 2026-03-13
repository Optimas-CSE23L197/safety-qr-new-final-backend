// =============================================================================
// utils/helpers/auditLogger.js — RESQID
//
// Single source of truth for all audit logging across the entire codebase.
// Every module — auth, order pipeline, token service — imports from here.
//
// SCHEMA (AuditLog):
//   actor_id    String        — non-nullable
//   actor_type  ActorType     — non-nullable (SUPER_ADMIN | SCHOOL_USER | PARENT_USER | SYSTEM)
//   action      String        — non-nullable
//   entity      String        — non-nullable
//   entity_id   String        — non-nullable
//   school_id   String?       — nullable
//   old_value   Json?         — nullable
//   new_value   Json?         — nullable
//   metadata    Json?         — nullable
//   ip_address  String?       — nullable
//   user_agent  String?       — nullable
//
// CALL SIGNATURE (all fields camelCase — maps to snake_case schema internally):
//   writeAuditLog({
//     actorId,      — required
//     actorType,    — required: "SUPER_ADMIN" | "SCHOOL_USER" | "PARENT_USER" | "SYSTEM"
//     action,       — required: string (use AuditAction constants below)
//     entity,       — required: "CardOrder" | "Token" | "SuperAdmin" | etc.
//     entityId,     — required: UUID of the record
//     schoolId,     — optional
//     oldValue,     — optional: object
//     newValue,     — optional: object
//     metadata,     — optional: any extra context
//     ip,           — optional: request IP
//     ua,           — optional: user-agent string
//   })
//
// BEHAVIOUR:
//   - Always fire-and-forget (.catch(() => {})). NEVER awaited — audit log
//     must never block or crash the main request flow.
//   - Returns the Promise so callers can await if they need to (rare).
//   - Silently swallows errors — logged to console.error only.
// =============================================================================

import { prisma } from "../../config/prisma.js";

// =============================================================================
// AUDIT ACTION CONSTANTS
// Central registry — prevents typo'd action strings scattered across files.
// Add new actions here when new features are built.
// =============================================================================

export const AuditAction = Object.freeze({
  // Auth
  LOGIN: "LOGIN",
  LOGOUT: "LOGOUT",
  LOGIN_FAILED: "LOGIN_FAILED",
  PASSWORD_CHANGED: "PASSWORD_CHANGED",
  TOKEN_REFRESHED: "TOKEN_REFRESHED",

  // Order lifecycle
  ORDER_CREATED: "ORDER_CREATED",
  ORDER_CONFIRMED: "ORDER_CONFIRMED",
  ADVANCE_INVOICE_ISSUED: "ADVANCE_INVOICE_ISSUED",
  ADVANCE_PAYMENT_RECEIVED: "ADVANCE_PAYMENT_RECEIVED",
  TOKENS_GENERATED: "TOKENS_GENERATED",
  CARD_DESIGN_COMPLETE: "CARD_DESIGN_COMPLETE",
  FILES_SENT_TO_VENDOR: "FILES_SENT_TO_VENDOR",
  PRINTING_STARTED: "PRINTING_STARTED",
  PRINT_COMPLETE: "PRINT_COMPLETE",
  SHIPMENT_CREATED: "SHIPMENT_CREATED",
  ORDER_SHIPPED: "ORDER_SHIPPED",
  ORDER_DELIVERED: "ORDER_DELIVERED",
  BALANCE_INVOICE_ISSUED: "BALANCE_INVOICE_ISSUED",
  BALANCE_PAYMENT_RECEIVED: "BALANCE_PAYMENT_RECEIVED",
  ORDER_COMPLETED: "ORDER_COMPLETED",
  ORDER_CANCELLED: "ORDER_CANCELLED",
  ORDER_REFUNDED: "ORDER_REFUNDED",

  // Token / card
  TOKEN_REVOKED: "TOKEN_REVOKED",
  TOKEN_ACTIVATED: "TOKEN_ACTIVATED",
  CARD_REPLACED: "CARD_REPLACED",

  // School / admin
  SCHOOL_CREATED: "SCHOOL_CREATED",
  SCHOOL_UPDATED: "SCHOOL_UPDATED",
  SCHOOL_DEACTIVATED: "SCHOOL_DEACTIVATED",
  ADMIN_CREATED: "ADMIN_CREATED",
  IP_BLOCKED: "IP_BLOCKED",
});

// =============================================================================
// writeAuditLog
// =============================================================================

/**
 * Write an audit log entry. Always fire-and-forget.
 *
 * @param {object} params
 * @param {string} params.actorId      — required: ID of the actor
 * @param {string} params.actorType    — required: ActorType enum value
 * @param {string} params.action       — required: use AuditAction constants
 * @param {string} params.entity       — required: model name e.g. "CardOrder"
 * @param {string} params.entityId     — required: UUID of the record
 * @param {string} [params.schoolId]   — optional
 * @param {object} [params.oldValue]   — optional: state before change
 * @param {object} [params.newValue]   — optional: state after change
 * @param {object} [params.metadata]   — optional: any extra context
 * @param {string} [params.ip]         — optional: request IP address
 * @param {string} [params.ua]         — optional: user-agent string
 *
 * @returns {Promise<void>} — fire-and-forget, errors are swallowed
 */
export const writeAuditLog = ({
  actorId,
  actorType,
  action,
  entity,
  entityId,
  schoolId,
  oldValue,
  newValue,
  metadata,
  ip,
  ua,
}) => {
  // Guard: these three fields are non-nullable in the schema.
  // If they're missing, log a warning and skip — don't throw into the main flow.
  if (!actorId || !action || !entity || !entityId) {
    console.error("[auditLogger] Missing required field — skipping:", {
      actorId: !!actorId,
      action,
      entity,
      entityId: !!entityId,
    });
    return Promise.resolve();
  }

  return prisma.auditLog
    .create({
      data: {
        actor_id: actorId,
        actor_type: actorType ?? "SYSTEM",
        action,
        entity,
        entity_id: entityId,
        school_id: schoolId ?? null,
        old_value: oldValue ?? null,
        new_value: newValue ?? null,
        metadata: metadata ?? null,
        ip_address: ip ?? null,
        user_agent: ua ?? null,
      },
    })
    .catch((err) => {
      // Audit log failure must never crash the main request.
      // Log to stderr for visibility in production log aggregators.
      console.error("[auditLogger] Write failed:", err?.message ?? err);
    });
};
