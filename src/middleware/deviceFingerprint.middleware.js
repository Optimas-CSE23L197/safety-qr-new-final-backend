// =============================================================================
// deviceFingerprint.middleware.js — RESQID
// Validates that the device making the request matches the active ParentDevice
// on record. Enforces single-device login at the HTTP layer — not just at the
// DB layer on login.
//
// Why this matters:
//   A stolen JWT from device A could be replayed from device B with no
//   detection if we only check the JWT and session. This middleware ensures
//   the device fingerprint in the request header matches the active device
//   record in ParentDevice, killing stolen-token replay attacks.
//
// Only applies to PARENT_USER — school users and super admins use
// password-based sessions from known browsers, not mobile device tokens.
//
// Header: X-Device-ID  (FCM/APNS device token or stable device fingerprint)
// =============================================================================

import { prisma } from '#config/prisma.js';
import { redis } from '#config/redis.js';
import { ApiError } from '#shared/response/ApiError.js';
import { asyncHandler } from '#shared/response/asyncHandler.js';

const DEVICE_CACHE_TTL = 60; // 1 minute — hot path, cache aggressively
const DEVICE_HEADER = 'x-device-id';

// ─── Core Middleware ──────────────────────────────────────────────────────────

/**
 * verifyDevice
 * Must run AFTER authenticate (needs req.userId and req.role)
 * Only enforced for PARENT_USER — mobile app only
 *
 * Checks:
 *   [1] X-Device-ID header present
 *   [2] Device exists in ParentDevice and belongs to this parent
 *   [3] Device is the active device (is_active = true)
 *   [4] Device has not been logged out
 */
export const verifyDevice = asyncHandler(async (req, _res, next) => {
  // Only enforce for mobile app (PARENT_USER)
  if (req.role !== 'PARENT_USER') return next();

  const deviceToken = req.headers[DEVICE_HEADER];

  if (!deviceToken) {
    throw ApiError.unauthorized('Device identification header missing (X-Device-ID required)');
  }

  const device = await getDevice(req.userId, deviceToken);

  if (!device) {
    throw ApiError.unauthorized('Device not recognized — please log in again');
  }

  // Device must belong to this parent
  if (device.parent_id !== req.userId) {
    // This is a serious security event — log at error level
    req.log?.error(
      {
        claimedUserId: req.userId,
        deviceOwnerId: device.parent_id,
        deviceToken: deviceToken.slice(0, 16) + '...', // partial for logs
      },
      'Device fingerprint mismatch — token used by wrong parent'
    );
    throw ApiError.unauthorized('Device does not belong to this account');
  }

  // Device must be the currently active device
  if (!device.is_active) {
    throw ApiError.unauthorized('This device has been logged out — please log in again');
  }

  // Device must not have a logged_out_at timestamp
  if (device.logged_out_at) {
    throw ApiError.unauthorized('This device session has ended — please log in again');
  }

  // Attach device info to request for downstream use
  req.deviceId = device.id;
  req.devicePlatform = device.platform;

  // Update last_seen_at async — non-blocking
  updateDeviceLastSeen(device.id).catch(e =>
    req.log?.warn({ deviceId: device.id, err: e.message }, 'Failed to update device last_seen_at')
  );

  next();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getDevice(parentId, deviceToken) {
  // Cache key: parent + device token (device token is the FCM/APNS token)
  const cacheKey = `device:${parentId}:${deviceToken}`;
  const cached = await redis.get(cacheKey);

  if (cached) return JSON.parse(cached);

  const device = await prisma.parentDevice.findFirst({
    where: {
      parent_id: parentId,
      device_token: deviceToken,
    },
    select: {
      id: true,
      parent_id: true,
      platform: true,
      is_active: true,
      logged_out_at: true,
      logout_reason: true,
    },
  });

  if (device) {
    await redis.setex(cacheKey, DEVICE_CACHE_TTL, JSON.stringify(device));
  }

  return device;
}

async function updateDeviceLastSeen(deviceId) {
  await prisma.parentDevice.update({
    where: { id: deviceId },
    data: { last_seen_at: new Date() },
  });
}

/**
 * invalidateDeviceCache
 * Call this when a device's is_active status changes (login/logout/force-logout)
 * so the cache doesn't serve stale active=true entries
 */
export async function invalidateDeviceCache(parentId, deviceToken) {
  await redis.del(`device:${parentId}:${deviceToken}`);
}
