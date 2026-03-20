import { prisma } from "../../config/prisma.js";
/**
 * =============================================================================
 * Auth Repository — RESQID
 * Pure DB access layer — NO business logic
 *
 * Actors:
 *   SuperAdmin
 *   SchoolUser
 *   ParentUser
 *
 * FIX [#14b]: createSession() was not accepting or writing refreshHash.
 * Since Session.refresh_token_hash is non-nullable in the schema, every
 * session.create() call was rejected by Prisma with:
 *   "Argument `refresh_token_hash` is missing."
 * Fixed by adding refreshHash to the createSession parameter destructure
 * and writing it into the data object on create.
 * updateSessionRefreshHash remains for the token REFRESH flow (hash rotation).
 * =============================================================================
 */

/**
 * ---------------------------------------------------------------------------
 * SUPER ADMIN
 * ---------------------------------------------------------------------------
 */

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
    select: {
      id: true,
      is_active: true,
    },
  });
};

export const updateSuperAdminLastLogin = async (id) => {
  return prisma.superAdmin.update({
    where: { id },
    data: {
      last_login_at: new Date(),
    },
  });
};

/**
 * ---------------------------------------------------------------------------
 * SCHOOL USER
 * ---------------------------------------------------------------------------
 */

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
    select: {
      id: true,
      school_id: true,
      role: true,
      is_active: true,
    },
  });
};

export const updateSchoolUserLastLogin = async (id) => {
  return prisma.schoolUser.update({
    where: { id },
    data: {
      last_login_at: new Date(),
    },
  });
};

/**
 * ---------------------------------------------------------------------------
 * PARENT USER
 * ---------------------------------------------------------------------------
 */

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
    select: {
      id: true,
      status: true,
    },
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
    select: {
      id: true,
      status: true,
    },
  });
};

export const updateParentLastLogin = async (id) => {
  return prisma.parentUser.update({
    where: { id },
    data: {
      last_login_at: new Date(),
    },
  });
};

/**
 * ---------------------------------------------------------------------------
 * SESSION MANAGEMENT
 * ---------------------------------------------------------------------------
 */

/**
 * createSession
 * Creates a new session with refresh_token_hash written in the same call.
 * refreshHash MUST be provided — Session.refresh_token_hash is non-nullable.
 * Callers must issue tokens first, then pass the resulting refreshHash here.
 */
export const createSession = async ({
  id, // pre-generated UUID — keeps JWT sessionId and DB in sync
  superAdminId,
  schoolUserId,
  parentUserId,
  deviceInfo,
  ipAddress,
  expiresAt,
  refreshHash, // required — Session.refresh_token_hash is non-nullable
}) => {
  return prisma.session.create({
    data: {
      ...(id && { id }), // use pre-generated ID if provided, else Prisma auto-generates
      admin_user_id: superAdminId ?? null,
      school_user_id: schoolUserId ?? null,
      parent_user_id: parentUserId ?? null,
      device_info: deviceInfo ? JSON.stringify(deviceInfo) : null, // schema expects String, not Object
      ip_address: ipAddress ?? null,
      expires_at: expiresAt,
      is_active: true,
      refresh_token_hash: refreshHash,
    },
    select: {
      id: true,
    },
  });
};

/**
 * updateSessionRefreshHash
 * Rotates the refresh token hash on an existing session.
 * Used exclusively by the token REFRESH flow — NOT by login flows.
 */
export const updateSessionRefreshHash = async (sessionId, refreshHash) => {
  return prisma.session.update({
    where: { id: sessionId },
    data: {
      refresh_token_hash: refreshHash,
    },
  });
};

export const findSessionByRefreshHash = async (hash) => {
  return prisma.session.findUnique({
    where: {
      refresh_token_hash: hash,
    },
    select: {
      id: true,
      admin_user_id: true,
      school_user_id: true,
      parent_user_id: true,
      expires_at: true,
      is_active: true,
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
    data: {
      is_active: false,
      revoke_reason: reason,
    },
  });
};

export const deleteSession = async (sessionId) => {
  return prisma.session.delete({
    where: { id: sessionId },
  });
};

/**
 * ---------------------------------------------------------------------------
 * JWT BLACKLIST
 * ---------------------------------------------------------------------------
 */

export const addToBlacklist = async (tokenHash, expiresAt) => {
  return prisma.blacklistToken.create({
    data: {
      token_hash: tokenHash,
      expires_at: expiresAt,
    },
  });
};
