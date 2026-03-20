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
const BEARER_REGEX = /^Bearer\s[\w-]+\.[\w-]+\.[\w-]+$/;

// ─── Core Auth ────────────────────────────────────────────────────────────────

/**
 * authenticate
 * Strict JWT verification — every check must pass or request dies immediately
 * No partial auth, no "optional" mode, no silent failures
 */
export const authenticate = asyncHandler(async (req, _res, next) => {
  const authHeader = req.headers.authorization;

  // [1] Header must exist and match exact Bearer format
  if (!authHeader || !BEARER_REGEX.test(authHeader)) {
    throw ApiError.unauthorized("Missing or malformed authorization header");
  }

  const token = authHeader.split(" ")[1];

  // [2] Verify JWT signature + expiry — no try/catch swallowing
  let payload;
  try {
    payload = jwt.verify(token, ENV.JWT_ACCESS_SECRET, {
      algorithms: ["HS256"], // explicit — reject all other algorithms
      issuer: "resqid",
      audience: "resqid-api",
    });
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      throw ApiError.unauthorized("Access token expired");
    }
    if (err.name === "JsonWebTokenError") {
      throw ApiError.unauthorized("Invalid access token");
    }
    throw ApiError.unauthorized("Token verification failed");
  }

  // [3] Token must have required fields
  if (!payload.sub || !payload.role || !payload.sessionId) {
    throw ApiError.unauthorized("Malformed token payload");
  }

  // [4] Blacklist check — Redis first, DB fallback
  // DB fallback ensures revoked tokens stay revoked even if Redis loses the key
  const tokenHash = hashToken(token);
  const isBlacklistedRedis = await redis.get(`${BLACKLIST_PREFIX}${tokenHash}`);
  if (isBlacklistedRedis) {
    throw ApiError.unauthorized("Token has been revoked");
  }
  // DB fallback — catches Redis eviction / restart gaps
  const dbBlacklist = await prisma.blacklistToken.findUnique({
    where: { token_hash: tokenHash },
    select: { expires_at: true },
  });
  if (dbBlacklist && new Date(dbBlacklist.expires_at) > new Date()) {
    // Re-hydrate Redis so future checks skip the DB round-trip
    const ttlSecs = Math.ceil(
      (new Date(dbBlacklist.expires_at) - Date.now()) / 1000,
    );
    if (ttlSecs > 0) {
      await redis
        .setex(`${BLACKLIST_PREFIX}${tokenHash}`, ttlSecs, "1")
        .catch(() => {}); // non-blocking, best-effort
    }
    throw ApiError.unauthorized("Token has been revoked");
  }

  // [5] Session must be active in DB — not revoked, not expired
  const cacheKey = `${SESSION_PREFIX}${payload.sessionId}`;
  let session = null;

  // Try Redis cache first
  const cachedSession = await redis.get(cacheKey);
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
      await redis.setex(cacheKey, 60, JSON.stringify(session));
    }
  }

  if (!session) {
    throw ApiError.unauthorized("Session not found");
  }
  if (!session.is_active) {
    throw ApiError.unauthorized(
      `Session ended: ${session.revoke_reason ?? "unknown"}`,
    );
  }
  if (new Date(session.expires_at) < new Date()) {
    throw ApiError.unauthorized("Session expired");
  }

  // [6] Load user based on role — fail hard if not found or not active
  // FIX: SCHOOL_USER now includes `role` field so RBAC sub-role resolution works
  const user = await loadUser(payload.role, payload.sub);
  if (!user) {
    throw ApiError.unauthorized("User account not found");
  }
  if (!isUserActive(user, payload.role)) {
    throw ApiError.unauthorized("User account is inactive or suspended");
  }

  // [7] Attach to request — downstream can trust these completely
  req.user = user;
  req.userId = payload.sub;
  req.role = payload.role;
  req.sessionId = payload.sessionId;
  req.token = token;
  req.tokenExp = payload.exp;

  // [8] Update last_active_at async — non-blocking, never fails the request
  updateLastActive(payload.sessionId).catch((e) =>
    logger.warn(
      { sessionId: payload.sessionId, err: e.message },
      "Failed to update session last_active_at",
    ),
  );

  next();
});

// ─── Role Guards ──────────────────────────────────────────────────────────────

/**
 * requireRole(...roles)
 * Must be called AFTER authenticate
 * Single mismatch = immediate 403
 */
export const requireRole = (...roles) =>
  asyncHandler(async (req, _res, next) => {
    if (!req.role) {
      throw ApiError.unauthorized("Not authenticated");
    }
    if (!roles.includes(req.role)) {
      throw ApiError.forbidden(`Role '${req.role}' is not permitted here`);
    }
    next();
  });

// Shorthand guards — semantic clarity in routes
export const requireSuperAdmin = requireRole("SUPER_ADMIN");
export const requireSchoolUser = requireRole("SCHOOL_USER");
export const requireParent = requireRole("PARENT_USER");
export const requireDashboard = requireRole("SUPER_ADMIN", "SCHOOL_USER");

// ─── Optional Auth ────────────────────────────────────────────────────────────

/**
 * optionalAuth
 * ONLY used on public emergency endpoint to enrich logs
 * Never blocks — never throws — attaches user if valid, continues either way
 */
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function loadUser(role, userId) {
  switch (role) {
    case "PARENT_USER":
      return prisma.parentUser.findUnique({
        where: { id: userId },
        select: { id: true, status: true, deleted_at: true },
      });
    case "SCHOOL_USER":
      return prisma.schoolUser.findUnique({
        where: { id: userId },
        // FIX [#2]: Added `role` field so rbac.middleware can resolve sub-role
        // (ADMIN / STAFF / VIEWER). Without this, all school users were silently
        // treated as ADMIN and received full permissions.
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
  if (role === "PARENT_USER") {
    return user.status === "ACTIVE" && !user.deleted_at;
  }
  return user.is_active === true;
}

async function updateLastActive(sessionId) {
  await prisma.session.update({
    where: { id: sessionId },
    data: { last_active_at: new Date() },
  });
}
