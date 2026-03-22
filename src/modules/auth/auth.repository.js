// =============================================================================
// src/modules/auth/repository.js — RESQID
// Pure DB access layer — NO business logic
// =============================================================================

import { prisma } from "../../config/prisma.js";

// ─── Super Admin ──────────────────────────────────────────────────────────────

export const findSuperAdminByEmail = (email) =>
  prisma.superAdmin.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      password_hash: true,
      name: true,
      is_active: true,
    },
  });

export const findSuperAdminById = (id) =>
  prisma.superAdmin.findUnique({
    where: { id },
    select: { id: true, is_active: true },
  });

export const updateSuperAdminLastLogin = (id) =>
  prisma.superAdmin.update({
    where: { id },
    data: { last_login_at: new Date() },
  });

// ─── School User ──────────────────────────────────────────────────────────────

export const findSchoolUserByEmail = (email) =>
  prisma.schoolUser.findUnique({
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

export const findSchoolUserById = (id) =>
  prisma.schoolUser.findUnique({
    where: { id },
    select: { id: true, school_id: true, role: true, is_active: true },
  });

export const updateSchoolUserLastLogin = (id) =>
  prisma.schoolUser.update({
    where: { id },
    data: { last_login_at: new Date() },
  });

// ─── Parent User ──────────────────────────────────────────────────────────────

export const findParentByPhoneIndex = (phoneIndex) =>
  prisma.parentUser.findUnique({
    where: { phone_index: phoneIndex },
    select: {
      id: true,
      phone: true,
      phone_index: true,
      is_phone_verified: true,
      status: true,
    },
  });

export const findParentById = (id) =>
  prisma.parentUser.findUnique({
    where: { id },
    select: { id: true, status: true },
  });

export const createParentUser = ({ encryptedPhone, phoneIndex }) =>
  prisma.parentUser.create({
    data: {
      phone: encryptedPhone,
      phone_index: phoneIndex,
      is_phone_verified: true,
      status: "ACTIVE",
    },
    select: { id: true, status: true },
  });

export const updateParentLastLogin = (id) =>
  prisma.parentUser.update({
    where: { id },
    data: { last_login_at: new Date() },
  });

// ─── Registration: Card lookup ────────────────────────────────────────────────

/**
 * findCardForRegistration(card_number)
 * Fetches card + student + whether already claimed by a parent.
 * Used only in registerInit — not for auth.
 */
export const findCardForRegistration = (card_number) =>
  prisma.card.findUnique({
    where: { card_number },
    select: {
      id: true,
      student_id: true,
      school_id: true,
      student: {
        select: {
          id: true,
          first_name: true,
          setup_stage: true,
          is_active: true,
          parents: { select: { id: true }, take: 1 },
        },
      },
    },
  });

/**
 * linkParentToStudent(tx, parentId, studentId)
 * Idempotent upsert — safe even if link already exists.
 * Must be called inside a Prisma $transaction.
 */
export const linkParentToStudent = (tx, parentId, studentId) =>
  tx.parentStudent.upsert({
    where: {
      parent_id_student_id: { parent_id: parentId, student_id: studentId },
    },
    update: {},
    create: {
      parent_id: parentId,
      student_id: studentId,
      relationship: "Parent",
      is_primary: true,
    },
  });

// ─── Session ──────────────────────────────────────────────────────────────────

export const createSession = ({
  id,
  superAdminId,
  schoolUserId,
  parentUserId,
  deviceInfo,
  ipAddress,
  expiresAt,
  refreshHash,
}) =>
  prisma.session.create({
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

export const updateSessionRefreshHash = (sessionId, refreshHash) =>
  prisma.session.update({
    where: { id: sessionId },
    data: { refresh_token_hash: refreshHash },
  });

export const findSessionByRefreshHash = (hash) =>
  prisma.session.findUnique({
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

export const findSessionById = (sessionId) =>
  prisma.session.findUnique({ where: { id: sessionId } });

export const revokeSession = (sessionId, reason = "MANUAL_LOGOUT") =>
  prisma.session.update({
    where: { id: sessionId },
    data: { is_active: false, revoked_at: new Date(), revoke_reason: reason },
  });

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

export const deleteSession = (sessionId) =>
  prisma.session.delete({ where: { id: sessionId } });

// ─── Audit ────────────────────────────────────────────────────────────────────

export const logFailedLogin = ({
  actorType,
  identifier,
  ipAddress,
  userAgent,
  reason,
}) =>
  prisma.auditLog.create({
    data: {
      actor_id: identifier,
      actor_type: actorType,
      action: "LOGIN_FAILED",
      entity: "Session",
      entity_id: identifier,
      metadata: { reason, ip: ipAddress },
      ip_address: ipAddress,
      user_agent: userAgent,
    },
  });

// ─── Blacklist ────────────────────────────────────────────────────────────────

export const addToBlacklist = (tokenHash, expiresAt) =>
  prisma.blacklistToken.create({
    data: { token_hash: tokenHash, expires_at: expiresAt },
  });

export const addRefreshToBlacklist = (refreshHash, expiresAt) =>
  prisma.blacklistToken.upsert({
    where: { token_hash: refreshHash },
    update: {},
    create: { token_hash: refreshHash, expires_at: expiresAt },
  });
