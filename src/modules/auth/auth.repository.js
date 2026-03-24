// =============================================================================
// src/modules/auth/auth.repository.js — RESQID
// PURE DATABASE ACCESS LAYER — NO BUSINESS LOGIC
// =============================================================================

import { prisma } from "../../config/prisma.js";

// =============================================================================
// SUPER ADMIN
// =============================================================================

export const findSuperAdminByEmail = (email) =>
  prisma.superAdmin.findUnique({
    where: { email: email.toLowerCase() },
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
    select: { id: true, name: true, email: true, is_active: true },
  });

export const updateSuperAdminLastLogin = (id) =>
  prisma.superAdmin.update({
    where: { id },
    data: { last_login_at: new Date() },
  });

export const updateSuperAdminPassword = (id, hashedPassword) =>
  prisma.superAdmin.update({
    where: { id },
    data: { password_hash: hashedPassword },
  });

// =============================================================================
// SCHOOL ADMIN
// =============================================================================

export const findSchoolUserByEmail = (email) =>
  prisma.schoolUser.findUnique({
    where: { email: email.toLowerCase() },
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
    select: {
      id: true,
      school_id: true,
      role: true,
      is_active: true,
      name: true,
    },
  });

export const updateSchoolUserLastLogin = (id) =>
  prisma.schoolUser.update({
    where: { id },
    data: { last_login_at: new Date() },
  });

export const updateSchoolUserPassword = (id, hashedPassword) =>
  prisma.schoolUser.update({
    where: { id },
    data: { password_hash: hashedPassword },
  });

// =============================================================================
// PARENT USER
// =============================================================================

export const findParentByPhoneIndex = (phoneIndex) =>
  prisma.parentUser.findUnique({
    where: { phone_index: phoneIndex },
    select: {
      id: true,
      phone: true,
      phone_index: true,
      is_phone_verified: true,
      status: true,
      preferred_language: true,
      last_login_at: true,
    },
  });

export const findParentById = (id) =>
  prisma.parentUser.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      phone: true,
      preferred_language: true,
    },
  });

export const createParentUser = ({ encryptedPhone, phoneIndex, language }) =>
  prisma.parentUser.create({
    data: {
      phone: encryptedPhone,
      phone_index: phoneIndex,
      is_phone_verified: true,
      status: "ACTIVE",
      preferred_language: language || "en",
    },
    select: { id: true, status: true, preferred_language: true },
  });

export const updateParentLastLogin = (id) =>
  prisma.parentUser.update({
    where: { id },
    data: { last_login_at: new Date() },
  });

export const updateParentPassword = (id, hashedPassword) =>
  prisma.parentUser.update({
    where: { id },
    data: { password_hash: hashedPassword },
  });

// =============================================================================
// CARD REGISTRATION
// =============================================================================

export const findCardForRegistration = (cardNumber) =>
  prisma.card.findUnique({
    where: { card_number: cardNumber },
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

export const findCardWithToken = (cardId) =>
  prisma.card.findUnique({
    where: { id: cardId },
    select: { token_id: true },
  });

export const updateCardStudent = (cardId, studentId) =>
  prisma.card.update({
    where: { id: cardId },
    data: { student_id: studentId },
  });

export const updateTokenStudent = (tokenId, studentId) =>
  prisma.token.update({
    where: { id: tokenId },
    data: {
      student_id: studentId,
      status: "ACTIVE",
    },
  });

// =============================================================================
// STUDENT
// =============================================================================

export const createStubStudent = (schoolId) =>
  prisma.student.create({
    data: {
      school_id: schoolId,
      first_name: null,
      last_name: null,
      setup_stage: "PENDING",
      is_active: true,
    },
    select: { id: true },
  });

export const createEmergencyProfile = (studentId) =>
  prisma.emergencyProfile.create({
    data: {
      student_id: studentId,
      visibility: "HIDDEN",
      is_visible: false,
    },
  });

// =============================================================================
// PARENT-STUDENT LINK
// =============================================================================

export const linkParentToStudent = (parentId, studentId) =>
  prisma.parentStudent.upsert({
    where: {
      parent_id_student_id: {
        parent_id: parentId,
        student_id: studentId,
      },
    },
    update: {},
    create: {
      parent_id: parentId,
      student_id: studentId,
      relationship: "Parent",
      is_primary: true,
    },
  });

export const createParentNotificationPref = (parentId) =>
  prisma.parentNotificationPref.upsert({
    where: { parent_id: parentId },
    update: {},
    create: { parent_id: parentId },
  });

// =============================================================================
// SESSION MANAGEMENT
// =============================================================================

// FIX: Use Prisma relation connect syntax instead of raw scalar FK fields.
// The generated runtime client only accepts relation objects for FK fields
// on create — direct scalar assignment (admin_user_id: "...") is rejected
// unless the client was generated with relationMode = "prisma" or newer drivers.
export const createSession = ({
  id,
  superAdminId,
  schoolUserId,
  parentUserId,
  deviceInfo,
  ipAddress,
  expiresAt,
  refreshHash,
  deviceFingerprint,
  deviceId,
}) =>
  prisma.session.create({
    data: {
      ...(id && { id }),
      // ── Connect exactly one user FK via relation object ──────────────────
      ...(superAdminId && {
        superAdmin: { connect: { id: superAdminId } },
      }),
      ...(schoolUserId && {
        schoolUser: { connect: { id: schoolUserId } },
      }),
      ...(parentUserId && {
        parentUser: { connect: { id: parentUserId } },
      }),
      // ── Remaining scalar fields ──────────────────────────────────────────
      device_id: deviceId ?? null,
      device_info: deviceInfo ? JSON.stringify(deviceInfo) : null,
      ip_address: ipAddress ?? null,
      expires_at: expiresAt,
      is_active: true,
      refresh_token_hash: refreshHash,
    },
    select: { id: true },
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
      device_id: true,
    },
  });

export const findSessionById = (sessionId) =>
  prisma.session.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      is_active: true,
      parent_user_id: true,
      school_user_id: true,
      admin_user_id: true,
    },
  });

export const updateSessionRefreshHash = (sessionId, refreshHash) =>
  prisma.session.update({
    where: { id: sessionId },
    data: { refresh_token_hash: refreshHash },
  });

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
      : role === "ADMIN"
        ? "school_user_id"
        : "parent_user_id";

  return prisma.session.updateMany({
    where: { [field]: userId, is_active: true },
    data: { is_active: false, revoked_at: new Date(), revoke_reason: reason },
  });
};

export const findAllActiveSessionIds = async (userId, role) => {
  const field =
    role === "SUPER_ADMIN"
      ? "admin_user_id"
      : role === "ADMIN"
        ? "school_user_id"
        : "parent_user_id";

  const sessions = await prisma.session.findMany({
    where: { [field]: userId, is_active: true },
    select: { id: true },
  });
  return sessions.map((s) => s.id);
};

// =============================================================================
// BLACKLIST TOKEN
// =============================================================================

export const addToBlacklist = (tokenHash, expiresAt) =>
  prisma.blacklistToken.upsert({
    where: { token_hash: tokenHash },
    update: {},
    create: { token_hash: tokenHash, expires_at: expiresAt },
  });

export const findBlacklistedToken = (tokenHash) =>
  prisma.blacklistToken.findUnique({
    where: { token_hash: tokenHash },
    select: { token_hash: true, expires_at: true },
  });

// =============================================================================
// AUDIT LOG
// =============================================================================

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

export const createAuditLog = ({
  actorId,
  actorType,
  action,
  entity,
  entityId,
  metadata,
  ip,
  ua,
}) =>
  prisma.auditLog.create({
    data: {
      actor_id: actorId,
      actor_type: actorType,
      action,
      entity,
      entity_id: entityId,
      metadata,
      ip_address: ip,
      user_agent: ua,
    },
  });
