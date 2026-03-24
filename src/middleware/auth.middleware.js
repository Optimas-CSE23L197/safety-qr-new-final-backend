// =============================================================================
// auth.middleware.js — RESQID
// Zero-tolerance auth — single fault = immediate 401, no fallback, no retry
// Covers: JWT verify, blacklist check, session active check, user status check
// =============================================================================

import jwt from "jsonwebtoken";
import { prisma } from "../config/prisma.js";
import { redis } from "../config/redis.js";
import { ApiError } from "../utils/response/ApiError.js";
import { asyncHandler } from "../utils/response/asyncHandler.js";
import { ENV } from "../config/env.js";
import { logger } from "../config/logger.js";
import { hashToken } from "../utils/security/hashUtil.js";

// ─── Constants ────────────────────────────────────────────────────────────────
const BLACKLIST_PREFIX = "blacklist:";
const SESSION_PREFIX = "session:";
const USER_PREFIX = "auth:user:";
const LAST_ACTIVE_PREFIX = "auth:la:";
const BEARER_REGEX = /^Bearer\s[\w-]+\.[\w-]+\.[\w-]+$/;

// ─── Redis values for blacklist ───────────────────────────────────────────────
// "1" = token IS blacklisted (revoked)
// "0" = token confirmed clean (cached negative — skip DB check)
// null = never seen before → must check DB
const BLACKLISTED = "1";
const CLEAN = "0";

// ─── TTLs ─────────────────────────────────────────────────────────────────────
const SESSION_TTL = 60; // 60s  — session active status
const USER_TTL = 5 * 60; // 5min — user profile (is_active, school_id, role)
const LAST_ACTIVE_TTL = 60; // 60s  — last_active_at write throttle window

// ─── Core Auth ────────────────────────────────────────────────────────────────

export const authenticate = asyncHandler(async (req, _res, next) => {
  let token = null;

  // ✅ 1. Try cookie first (for browser)
  if (req.cookies?.accessToken) {
    token = req.cookies.accessToken;
  }

  // ✅ 2. Fallback to Authorization header (for APIs/mobile)
  else if (
    req.headers.authorization &&
    BEARER_REGEX.test(req.headers.authorization)
  ) {
    token = req.headers.authorization.split(" ")[1];
  }

  // ❌ No token at all
  if (!token) {
    throw ApiError.unauthorized("Missing authentication token");
  }
  // [2] Verify JWT signature + expiry
  let payload;
  try {
    payload = jwt.verify(token, ENV.JWT_ACCESS_SECRET, {
      algorithms: ["HS256"],
      issuer: "resqid",
      audience: "resqid-api",
    });
  } catch (err) {
    if (err.name === "TokenExpiredError")
      throw ApiError.unauthorized("Access token expired");
    if (err.name === "JsonWebTokenError")
      throw ApiError.unauthorized("Invalid access token");
    throw ApiError.unauthorized("Token verification failed");
  }

  // [3] Payload integrity
  if (!payload.sub || !payload.role || !payload.sessionId) {
    throw ApiError.unauthorized("Malformed token payload");
  }

  // [4] Blacklist check
  // Redis values:
  //   "1"  → blacklisted → reject immediately
  //   "0"  → confirmed clean (cached negative) → skip DB entirely
  //   null → never seen → must check DB, then cache result
  const tokenHash = hashToken(token);
  const blacklistKey = `${BLACKLIST_PREFIX}${tokenHash}`;
  const cachedStatus = await redis.get(blacklistKey).catch(() => null);

  if (cachedStatus === BLACKLISTED) {
    throw ApiError.unauthorized("Token has been revoked");
  }

  if (cachedStatus === null) {
    // Cache miss — check DB (only happens once per token lifetime)
    const dbBlacklist = await prisma.blacklistToken.findUnique({
      where: { token_hash: tokenHash },
      select: { expires_at: true },
    });

    if (dbBlacklist && new Date(dbBlacklist.expires_at) > new Date()) {
      // Token IS blacklisted — cache as "1" for remaining lifetime
      const ttlSecs = Math.ceil(
        (new Date(dbBlacklist.expires_at) - Date.now()) / 1000,
      );
      if (ttlSecs > 0) {
        redis.setex(blacklistKey, ttlSecs, BLACKLISTED).catch(() => {});
      }
      throw ApiError.unauthorized("Token has been revoked");
    }

    // Token is clean — cache as "0" for remaining JWT lifetime
    // This eliminates ALL future DB blacklist checks for this token
    const remainingTtl = Math.ceil(payload.exp - Date.now() / 1000);
    if (remainingTtl > 0) {
      redis.setex(blacklistKey, remainingTtl, CLEAN).catch(() => {});
    }
  }
  // cachedStatus === "0" → confirmed clean → fall through, no DB check needed

  // [5] Session check — Redis cache → DB fallback
  const sessionKey = `${SESSION_PREFIX}${payload.sessionId}`;
  let session = null;

  const cachedSession = await redis.get(sessionKey).catch(() => null);
  if (cachedSession) {
    session = JSON.parse(cachedSession);
  } else {
    session = await prisma.session.findUnique({
      where: { id: payload.sessionId },
      select: {
        id: true,
        is_active: true,
        expires_at: true,
        revoke_reason: true,
        parent_user_id: true,
        school_user_id: true,
        admin_user_id: true,
      },
    });
    if (session) {
      redis
        .setex(sessionKey, SESSION_TTL, JSON.stringify(session))
        .catch(() => {});
    }
  }

  if (!session) throw ApiError.unauthorized("Session not found");
  if (!session.is_active)
    throw ApiError.unauthorized(
      `Session ended: ${session.revoke_reason ?? "unknown"}`,
    );
  if (new Date(session.expires_at) < new Date())
    throw ApiError.unauthorized("Session expired");

  // [6] User profile — Redis cache → DB fallback
  const user = await loadUserCached(payload.role, payload.sub);
  if (!user) throw ApiError.unauthorized("User account not found");
  if (!isUserActive(user, payload.role))
    throw ApiError.unauthorized("User account is inactive or suspended");

  // [7] Attach to request
  req.user = user;
  req.user.school_id = user.school_id;
  req.user.schoolId = user.school_id; // normalize both
  req.userId = payload.sub;
  req.role = payload.role;
  req.sessionId = payload.sessionId;
  req.token = token;
  req.tokenExp = payload.exp;

  // [8] Throttled last_active_at — DB write at most once per 60s per session
  throttledLastActive(payload.sessionId).catch((e) =>
    logger.warn(
      { sessionId: payload.sessionId, err: e.message },
      "Failed to update last_active_at",
    ),
  );

  next();
});

// ─── Role Guards ──────────────────────────────────────────────────────────────

export const requireRole = (...roles) =>
  asyncHandler(async (req, _res, next) => {
    if (!req.role) throw ApiError.unauthorized("Not authenticated");
    if (!roles.includes(req.role)) {
      throw ApiError.forbidden(`Role '${req.role}' is not permitted here`);
    }
    next();
  });

export const requireSuperAdmin = requireRole("SUPER_ADMIN");
export const requireSchoolUser = requireRole("ADMIN");
export const requireParent = requireRole("PARENT_USER");
export const requireDashboard = requireRole("SUPER_ADMIN", "ADMIN");

// ─── Optional Auth ────────────────────────────────────────────────────────────

export const optionalAuth = asyncHandler(async (req, _res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !BEARER_REGEX.test(authHeader)) return next();

    const token = authHeader.split(" ")[1];
    const payload = jwt.verify(token, ENV.JWT_ACCESS_SECRET, {
      algorithms: ["HS256"],
      issuer: "resqid",
      audience: "resqid-api",
    });

    req.userId = payload.sub;
    req.role = payload.role;
  } catch {
    // Intentionally swallow — public route, auth is optional
  }
  next();
});

// ─── User Cache ───────────────────────────────────────────────────────────────

async function loadUserCached(role, userId) {
  const cacheKey = `${USER_PREFIX}${role}:${userId}`;

  try {
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached);
  } catch {
    // Redis failure → fall through to DB
  }

  const user = await loadUserFromDb(role, userId);

  if (user) {
    redis.setex(cacheKey, USER_TTL, JSON.stringify(user)).catch(() => {});
  }

  return user;
}

async function loadUserFromDb(role, userId) {
  switch (role) {
    case "PARENT_USER":
      return prisma.parentUser.findUnique({
        where: { id: userId },
        select: { id: true, status: true, deleted_at: true },
      });
    case "ADMIN":
      return prisma.schoolUser.findUnique({
        where: { id: userId },
        select: { id: true, is_active: true, school_id: true, role: true },
      });
    case "SUPER_ADMIN":
      return prisma.superAdmin.findUnique({
        where: { id: userId },
        select: { id: true, is_active: true },
      });
    default:
      return null;
  }
}

function isUserActive(user, role) {
  if (role === "PARENT_USER")
    return user.status === "ACTIVE" && !user.deleted_at;
  return user.is_active === true;
}

// ─── Throttled last_active_at ─────────────────────────────────────────────────

async function throttledLastActive(sessionId) {
  const gateKey = `${LAST_ACTIVE_PREFIX}${sessionId}`;

  try {
    // SET NX EX — atomic: set only if key doesn't exist, with TTL
    // Returns "OK" if set (first call in window) → write to DB
    // Returns null if key exists (already updated recently) → skip
    const set = await redis.set(gateKey, "1", "EX", LAST_ACTIVE_TTL, "NX");
    if (!set) return;
  } catch {
    // Redis failure → write to DB anyway (safe fallback)
  }

  await prisma.session.update({
    where: { id: sessionId },
    data: { last_active_at: new Date() },
  });
}

// ─── Cache Invalidation (exported — called from auth.service.js) ──────────────

/**
 * invalidateUserCache(role, userId)
 * Call when: user suspended, deleted, role changed, school transferred
 */
export async function invalidateUserCache(role, userId) {
  await redis.del(`${USER_PREFIX}${role}:${userId}`).catch(() => {});
}

/**
 * invalidateSessionCache(sessionId)
 * Call when: logout, session revoked, refresh token rotated
 */
export async function invalidateSessionCache(sessionId) {
  await redis.del(`${SESSION_PREFIX}${sessionId}`).catch(() => {});
}

/**
 * invalidateBlacklistCache(tokenHash)
 * Call when: token added to blacklist (logout/revoke)
 * Forces next request to re-check DB and cache "1" (blacklisted)
 * Prevents the "0" (clean) cached value from serving a revoked token
 */
export async function invalidateBlacklistCache(tokenHash) {
  await redis.del(`${BLACKLIST_PREFIX}${tokenHash}`).catch(() => {});
}
