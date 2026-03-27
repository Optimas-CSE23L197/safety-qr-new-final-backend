// =============================================================================
// rbac.middleware.js — RESQID
// Role-Based Access Control — strict, no implicit permissions
// Every action must be explicitly allowed — deny by default
// =============================================================================

import { ApiError } from '#shared/response/ApiError.js';
import { asyncHandler } from '#shared/response/asyncHandler.js';

// ─── Permission Map ───────────────────────────────────────────────────────────
// Explicit allow-list — if action is not listed, it is DENIED
// Format: 'resource:action'

const PERMISSIONS = {
  SUPER_ADMIN: new Set([
    // Schools
    'school:create',
    'school:read',
    'school:update',
    'school:delete',
    'school:activate',
    'school:deactivate',

    // Tokens & QR
    'token:generate',
    'token:revoke',
    'token:read',
    'token:bulk_generate',
    'qr:generate',
    'qr:read',
    'qr:delete',

    // Orders
    'order:create',
    'order:read',
    'order:update',
    'order:confirm',
    'order:process',
    'order:ship',
    'order:cancel',
    'order:refund',

    // Users (platform-wide)
    'parent:read',
    'parent:suspend',
    'parent:delete',
    'school_user:create',
    'school_user:read',
    'school_user:update',

    // Students (platform-wide)
    'student:read',
    'student:update',
    'student:delete',

    // Billing
    'subscription:read',
    'subscription:update',
    'subscription:cancel',
    'payment:read',
    'invoice:create',
    'invoice:read',
    'invoice:send',

    // Anomalies & Safety
    'anomaly:read',
    'anomaly:resolve',
    'scan_log:read',

    // System
    'feature_flag:read',
    'feature_flag:update',
    'audit_log:read',
    'system:health',

    // Super admin specific
    'super_admin:create',
    'super_admin:read',
  ]),

  SCHOOL_ADMIN: new Set([
    // Students
    'student:read',
    'student:create',
    'student:update',
    'student:delete',

    // Tokens — read only (generation is super admin only)
    'token:read',

    // Orders
    'order:create',
    'order:read',

    // Card template
    'card_template:read',
    'card_template:update',

    // School settings
    'school_settings:read',
    'school_settings:update',

    // Monitoring
    'scan_log:read',
    'anomaly:read',

    // School user management (view/manage their own school's users)
    'school_user:read',
    'school_user:create',
    'school_user:update',
  ]),

  PARENT_USER: new Set([
    // Own children only — enforced by restrictionOwnSchool middleware
    'student:read_own',
    'student:update_own',
    'emergency_profile:read_own',
    'emergency_profile:update_own',
    'emergency_contact:create_own',
    'emergency_contact:update_own',
    'emergency_contact:delete_own',
    'card_visibility:read_own',
    'card_visibility:update_own',
    'qr:read_own', // view own child's QR
    'notification_pref:read_own',
    'notification_pref:update_own',

    // Own account
    'parent:read_own',
    'parent:update_own',
    'parent:delete_own',
    'device:read_own',
    'device:delete_own',
    'session:read_own',
    'session:revoke_own',
  ]),
};

// ─── Role Resolution ──────────────────────────────────────────────────────────

function resolvePermissionSet(req) {
  const { role } = req;

  if (role === 'SUPER_ADMIN') return PERMISSIONS.SUPER_ADMIN;
  if (role === 'PARENT_USER') return PERMISSIONS.PARENT_USER;

  if (role === 'SCHOOL_USER') {
    const schoolRole = req.user?.role;

    if (!schoolRole) {
      req.log?.error(
        { userId: req.userId },
        'RBAC: req.user.role is undefined for SCHOOL_USER — hard blocking. Check auth.middleware loadUser select.'
      );
      return new Set();
    }

    if (schoolRole === 'ADMIN') return PERMISSIONS.SCHOOL_ADMIN;

    throw ApiError.forbidden(`School role '${schoolRole}' does not have access to this system`);
  }

  return new Set();
}

// ─── Core RBAC Middleware ─────────────────────────────────────────────────────

export const can = permission =>
  asyncHandler(async (req, _res, next) => {
    if (!req.role) {
      throw ApiError.unauthorized('Not authenticated');
    }

    const permissions = resolvePermissionSet(req);

    if (!permissions.has(permission)) {
      throw ApiError.forbidden(
        `Permission denied: '${permission}' not allowed for role '${req.role}'`
      );
    }

    next();
  });

export const canAny = (...permissions) =>
  asyncHandler(async (req, _res, next) => {
    if (!req.role) {
      throw ApiError.unauthorized('Not authenticated');
    }

    const userPermissions = resolvePermissionSet(req);
    const hasAny = permissions.some(p => userPermissions.has(p));

    if (!hasAny) {
      throw ApiError.forbidden(
        `Permission denied: none of [${permissions.join(', ')}] allowed for '${req.role}'`
      );
    }

    next();
  });

export const canAll = (...permissions) =>
  asyncHandler(async (req, _res, next) => {
    if (!req.role) {
      throw ApiError.unauthorized('Not authenticated');
    }

    const userPermissions = resolvePermissionSet(req);
    const missingPerms = permissions.filter(p => !userPermissions.has(p));

    if (missingPerms.length > 0) {
      throw ApiError.forbidden(`Permission denied: missing [${missingPerms.join(', ')}]`);
    }

    next();
  });

export const requireSchoolRole = (...schoolRoles) =>
  asyncHandler(async (req, _res, next) => {
    if (req.role !== 'SCHOOL_USER') {
      throw ApiError.forbidden('School user role required');
    }

    const userSchoolRole = req.user?.role;
    if (!userSchoolRole) {
      throw ApiError.internal('Cannot determine school role — auth configuration error');
    }

    if (userSchoolRole !== 'ADMIN') {
      throw ApiError.forbidden(
        `School role '${userSchoolRole}' does not have access to this system`
      );
    }

    if (!schoolRoles.includes(userSchoolRole)) {
      throw ApiError.forbidden(
        `School role '${userSchoolRole}' not permitted — requires [${schoolRoles.join(', ')}]`
      );
    }

    next();
  });

// ✅ ADD THIS - Super Admin middleware
export const requireSuperAdmin = asyncHandler(async (req, _res, next) => {
  if (!req.role) {
    throw ApiError.unauthorized('Not authenticated');
  }

  if (req.role !== 'SUPER_ADMIN') {
    throw ApiError.forbidden('Access denied. Super admin privileges required.');
  }

  next();
});

// Add this to rbac.middleware.js at the bottom
export const rbac = allowedRoles => {
  return asyncHandler(async (req, _res, next) => {
    if (!req.role) {
      throw ApiError.unauthorized('Not authenticated');
    }

    if (!allowedRoles.includes(req.role)) {
      throw ApiError.forbidden(`Access denied. Required roles: ${allowedRoles.join(', ')}`);
    }

    next();
  });
};
