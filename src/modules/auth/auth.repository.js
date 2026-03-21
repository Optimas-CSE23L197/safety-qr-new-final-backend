// =============================================================================
// auth.repository.js — RESQID
// Pure DB access layer — NO business logic
// =============================================================================

import { prisma } from "../../config/prisma.js";

// ─── Super Admin ──────────────────────────────────────────────────────────────

export const findSuperAdminByEmail = async (email) => {
  return prisma.superAdmin.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      password_hash: true,
      name: true,
      is_active: true,
    },
  });
};

export const findSuperAdminById = async (id) => {
  return prisma.superAdmin.findUnique({
    where: { id },
    select: { id: true, is_active: true },
  });
};

export const updateSuperAdminLastLogin = async (id) => {
  return prisma.superAdmin.update({
    where: { id },
    data: { last_login_at: new Date() },
  });
};

// ─── School User ──────────────────────────────────────────────────────────────

export const findSchoolUserByEmail = async (email) => {
  return prisma.schoolUser.findUnique({
    where: { email },
    select: {
      id: true,
      school_id: true,
      email: true,
      password_hash: true,
      name: true,
      role: true,
      is_active: true,
    },
  });
};

export const findSchoolUserById = async (id) => {
  return prisma.schoolUser.findUnique({
    where: { id },
    select: { id: true, school_id: true, role: true, is_active: true },
  });
};

export const updateSchoolUserLastLogin = async (id) => {
  return prisma.schoolUser.update({
    where: { id },
    data: { last_login_at: new Date() },
  });
};

// ─── Parent User ──────────────────────────────────────────────────────────────

export const findParentByPhoneIndex = async (phoneIndex) => {
  return prisma.parentUser.findUnique({
    where: { phone_index: phoneIndex },
    select: {
      id: true,
      phone: true,
      phone_index: true,
      is_phone_verified: true,
      status: true,
    },
  });
};

export const findParentById = async (id) => {
  return prisma.parentUser.findUnique({
    where: { id },
    select: { id: true, status: true },
  });
};

export const createParentUser = async ({ encryptedPhone, phoneIndex }) => {
  return prisma.parentUser.create({
    data: {
      phone: encryptedPhone,
      phone_index: phoneIndex,
      is_phone_verified: true,
      status: "ACTIVE",
    },
    select: { id: true, status: true },
  });
};

export const updateParentLastLogin = async (id) => {
  return prisma.parentUser.update({
    where: { id },
    data: { last_login_at: new Date() },
  });
};

// ─── Session ──────────────────────────────────────────────────────────────────

export const createSession = async ({
  id,
  superAdminId,
  schoolUserId,
  parentUserId,
  deviceInfo,
  ipAddress,
  expiresAt,
  refreshHash,
}) => {
  return prisma.session.create({
    data: {
      ...(id && { id }),
      admin_user_id: superAdminId ?? null,
      school_user_id: schoolUserId ?? null,
      parent_user_id: parentUserId ?? null,
      device_info: deviceInfo ? JSON.stringify(deviceInfo) : null,
      ip_address: ipAddress ?? null,
      expires_at: expiresAt,
      is_active: true,
      refresh_token_hash: refreshHash,
    },
    select: { id: true },
  });
};

export const updateSessionRefreshHash = async (sessionId, refreshHash) => {
  return prisma.session.update({
    where: { id: sessionId },
    data: { refresh_token_hash: refreshHash },
  });
};

export const findSessionByRefreshHash = async (hash) => {
  return prisma.session.findUnique({
    where: { refresh_token_hash: hash },
    select: {
      id: true,
      admin_user_id: true,
      school_user_id: true,
      parent_user_id: true,
      expires_at: true,
      is_active: true,
      revoke_reason: true,
    },
  });
};

export const findSessionById = async (sessionId) => {
  return prisma.session.findUnique({
    where: { id: sessionId },
  });
};

export const revokeSession = async (sessionId, reason = "MANUAL_LOGOUT") => {
  return prisma.session.update({
    where: { id: sessionId },
    data: { is_active: false, revoked_at: new Date(), revoke_reason: reason },
  });
};

/**
 * revokeAllUserSessions
 * SECURITY: wipes every active session for a user across all devices.
 * Called on: refresh token reuse detection, password change, account suspend.
 * Returns count of revoked sessions.
 */
export const revokeAllUserSessions = async (
  userId,
  role,
  reason = "SUSPICIOUS_ACTIVITY",
) => {
  const field =
    role === "SUPER_ADMIN"
      ? "admin_user_id"
      : role === "SCHOOL_USER"
        ? "school_user_id"
        : "parent_user_id";

  const result = await prisma.session.updateMany({
    where: { [field]: userId, is_active: true },
    data: { is_active: false, revoked_at: new Date(), revoke_reason: reason },
  });

  return result.count;
};

/**
 * findAllActiveSessionIds
 * Used after revokeAllUserSessions to bulk-invalidate Redis caches.
 */
export const findAllActiveSessionIds = async (userId, role) => {
  const field =
    role === "SUPER_ADMIN"
      ? "admin_user_id"
      : role === "SCHOOL_USER"
        ? "school_user_id"
        : "parent_user_id";

  const sessions = await prisma.session.findMany({
    where: { [field]: userId, is_active: true },
    select: { id: true },
  });

  return sessions.map((s) => s.id);
};

export const deleteSession = async (sessionId) => {
  return prisma.session.delete({ where: { id: sessionId } });
};

// ─── Failed Login Audit ───────────────────────────────────────────────────────

/**
 * logFailedLogin
 * SECURITY: records failed login attempts in AuditLog.
 * Enables: brute force detection, security alerts, forensic investigation.
 * Called on every credential mismatch in loginSuperAdmin / loginSchoolUser.
 */
export const logFailedLogin = async ({
  actorType,
  identifier,
  ipAddress,
  userAgent,
  reason,
}) => {
  return prisma.auditLog.create({
    data: {
      actor_id: identifier, // email used in attempt
      actor_type: actorType, // SUPER_ADMIN | SCHOOL_USER
      action: "LOGIN_FAILED",
      entity: "Session",
      entity_id: identifier,
      metadata: { reason, ip: ipAddress },
      ip_address: ipAddress,
      user_agent: userAgent,
    },
  });
};

// ─── Blacklist ────────────────────────────────────────────────────────────────

export const addToBlacklist = async (tokenHash, expiresAt) => {
  return prisma.blacklistToken.create({
    data: { token_hash: tokenHash, expires_at: expiresAt },
  });
};

/**
 * addRefreshToBlacklist
 * SECURITY: blacklists refresh token hash on logout so it can't be replayed.
 * Stored in BlacklistToken same as access tokens — same cleanup job applies.
 */
export const addRefreshToBlacklist = async (refreshHash, expiresAt) => {
  return prisma.blacklistToken.upsert({
    where: { token_hash: refreshHash },
    update: {}, // already blacklisted — no-op
    create: { token_hash: refreshHash, expires_at: expiresAt },
  });
};
