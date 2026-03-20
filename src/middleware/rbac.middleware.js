// =============================================================================
// rbac.middleware.js — RESQID
// Role-Based Access Control — strict, no implicit permissions
// Every action must be explicitly allowed — deny by default
//
// SCHOOL_USER sub-roles:
//   ADMIN  → full school-scoped permissions (the only active role)
//   STAFF  → hard-blocked, no permissions, immediate 403
//   VIEWER → hard-blocked, no permissions, immediate 403
//
// Only SCHOOL_ADMIN has access to the dashboard. STAFF and VIEWER accounts
// can be created in the DB but cannot authenticate into any protected route.
// =============================================================================

import { ApiError } from "../utils/response/ApiError.js";
import { asyncHandler } from "../utils/response/asyncHandler.js";

// ─── Permission Map ───────────────────────────────────────────────────────────
// Explicit allow-list — if action is not listed, it is DENIED
// Format: 'resource:action'

const PERMISSIONS = {
  SUPER_ADMIN: new Set([
    // Schools
    "school:create",
    "school:read",
    "school:update",
    "school:delete",
    "school:activate",
    "school:deactivate",

    // Tokens & QR
    "token:generate",
    "token:revoke",
    "token:read",
    "token:bulk_generate",
    "qr:generate",
    "qr:read",
    "qr:delete",

    // Orders
    "order:create",
    "order:read",
    "order:update",
    "order:confirm",
    "order:process",
    "order:ship",
    "order:cancel",
    "order:refund",

    // Users (platform-wide)
    "parent:read",
    "parent:suspend",
    "parent:delete",
    "school_user:create",
    "school_user:read",
    "school_user:update",

    // Students (platform-wide)
    "student:read",
    "student:update",
    "student:delete",

    // Billing
    "subscription:read",
    "subscription:update",
    "subscription:cancel",
    "payment:read",
    "invoice:create",
    "invoice:read",
    "invoice:send",

    // Anomalies & Safety
    "anomaly:read",
    "anomaly:resolve",
    "scan_log:read",

    // System
    "feature_flag:read",
    "feature_flag:update",
    "audit_log:read",
    "system:health",

    // Super admin specific
    "super_admin:create",
    "super_admin:read",
  ]),

  // SCHOOL_ADMIN — the ONLY school sub-role with any permissions.
  // STAFF and VIEWER are defined in the SchoolRole enum but have zero
  // permissions in this system — they are hard-blocked at resolvePermissionSet.
  SCHOOL_ADMIN: new Set([
    // Students
    "student:read",
    "student:create",
    "student:update",
    "student:delete",

    // Tokens — read only (generation is super admin only)
    "token:read",

    // Orders
    "order:create",
    "order:read",

    // Card template
    "card_template:read",
    "card_template:update",

    // School settings
    "school_settings:read",
    "school_settings:update",

    // Monitoring
    "scan_log:read",
    "anomaly:read",

    // School user management (view/manage their own school's users)
    "school_user:read",
    "school_user:create",
    "school_user:update",
  ]),

  PARENT_USER: new Set([
    // Own children only — enforced by restrictionOwnSchool middleware
    "student:read_own",
    "student:update_own",
    "emergency_profile:read_own",
    "emergency_profile:update_own",
    "emergency_contact:create_own",
    "emergency_contact:update_own",
    "emergency_contact:delete_own",
    "card_visibility:read_own",
    "card_visibility:update_own",
    "qr:read_own", // view own child's QR
    "notification_pref:read_own",
    "notification_pref:update_own",

    // Own account
    "parent:read_own",
    "parent:update_own",
    "parent:delete_own",
    "device:read_own",
    "device:delete_own",
    "session:read_own",
    "session:revoke_own",
  ]),
};

// ─── Role Resolution ──────────────────────────────────────────────────────────

/**
 * resolvePermissionSet
 *
 * For SCHOOL_USER, reads req.user.role (SchoolRole enum: ADMIN | STAFF | VIEWER)
 * which is populated by auth.middleware's loadUser query.
 *
 * DEPENDENCY: auth.middleware must select `role` in the SCHOOL_USER query.
 * If req.user.role is undefined here it means auth.middleware is not selecting
 * the field — this is a configuration bug, not a permissions bug. We default
 * to SCHOOL_VIEWER (most restrictive) rather than SCHOOL_USER (ADMIN) to
 * fail-safe on the side of least privilege.
 */
function resolvePermissionSet(req) {
  const { role } = req;

  if (role === "SUPER_ADMIN") return PERMISSIONS.SUPER_ADMIN;
  if (role === "PARENT_USER") return PERMISSIONS.PARENT_USER;

  if (role === "SCHOOL_USER") {
    const schoolRole = req.user?.role;

    if (!schoolRole) {
      // Should never happen — means auth.middleware isn't selecting `role`
      req.log?.error(
        { userId: req.userId },
        "RBAC: req.user.role is undefined for SCHOOL_USER — hard blocking. Check auth.middleware loadUser select.",
      );
      return new Set(); // no permissions — fail closed
    }

    // ONLY ADMIN has permissions in this system.
    // STAFF and VIEWER are intentionally blocked — they have no access.
    if (schoolRole === "ADMIN") return PERMISSIONS.SCHOOL_ADMIN;

    // STAFF or VIEWER — hard block with a clear 403
    throw ApiError.forbidden(
      `School role '${schoolRole}' does not have access to this system`,
    );
  }

  return new Set(); // Unknown role = no permissions
}

// ─── Core RBAC Middleware ─────────────────────────────────────────────────────

/**
 * can(permission)
 * Usage: router.patch('/student/:id', authenticate, can('student:update_own'), handler)
 * Single permission check — hard deny if not in allowed set
 */
export const can = (permission) =>
  asyncHandler(async (req, _res, next) => {
    if (!req.role) {
      throw ApiError.unauthorized("Not authenticated");
    }

    const permissions = resolvePermissionSet(req);

    if (!permissions.has(permission)) {
      throw ApiError.forbidden(
        `Permission denied: '${permission}' not allowed for role '${req.role}'`,
      );
    }

    next();
  });

/**
 * canAny(...permissions)
 * Allows if user has AT LEAST ONE of the listed permissions
 * Used for endpoints accessible by multiple roles
 */
export const canAny = (...permissions) =>
  asyncHandler(async (req, _res, next) => {
    if (!req.role) {
      throw ApiError.unauthorized("Not authenticated");
    }

    const userPermissions = resolvePermissionSet(req);
    const hasAny = permissions.some((p) => userPermissions.has(p));

    if (!hasAny) {
      throw ApiError.forbidden(
        `Permission denied: none of [${permissions.join(", ")}] allowed for '${req.role}'`,
      );
    }

    next();
  });

/**
 * canAll(...permissions)
 * Allows only if user has ALL listed permissions
 * Used for sensitive compound operations
 */
export const canAll = (...permissions) =>
  asyncHandler(async (req, _res, next) => {
    if (!req.role) {
      throw ApiError.unauthorized("Not authenticated");
    }

    const userPermissions = resolvePermissionSet(req);
    const missingPerms = permissions.filter((p) => !userPermissions.has(p));

    if (missingPerms.length > 0) {
      throw ApiError.forbidden(
        `Permission denied: missing [${missingPerms.join(", ")}]`,
      );
    }

    next();
  });

/**
 * requireSchoolRole(...schoolRoles)
 * For SCHOOL_USER routes — check their sub-role (ADMIN/STAFF/VIEWER)
 * Must come after authenticate.
 *
 * In this system, only ADMIN has any access. Passing "ADMIN" here is the
 * only valid usage. STAFF and VIEWER are hard-blocked.
 */
export const requireSchoolRole = (...schoolRoles) =>
  asyncHandler(async (req, _res, next) => {
    if (req.role !== "SCHOOL_USER") {
      throw ApiError.forbidden("School user role required");
    }

    const userSchoolRole = req.user?.role;
    if (!userSchoolRole) {
      throw ApiError.internal(
        "Cannot determine school role — auth configuration error",
      );
    }

    // Hard-block STAFF and VIEWER regardless of what schoolRoles was passed
    if (userSchoolRole !== "ADMIN") {
      throw ApiError.forbidden(
        `School role '${userSchoolRole}' does not have access to this system`,
      );
    }

    if (!schoolRoles.includes(userSchoolRole)) {
      throw ApiError.forbidden(
        `School role '${userSchoolRole}' not permitted — requires [${schoolRoles.join(", ")}]`,
      );
    }

    next();
  });
