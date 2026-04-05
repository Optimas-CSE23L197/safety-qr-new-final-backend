// =============================================================================
// modules/scan/scan.repository.js — RESQID
//
// All DB reads for the public QR scan flow.
// This file never modifies profile data — read-only except ScanLog.
//
// QUERY STRATEGY:
//   Single indexed PK lookup: Token.id
//   All joins via FK relations — no raw SQL, no N+1
//   ScanLog write is replaced by Redis queue enqueue (see scan.cache.js)
//   Direct writeScanLog kept for edge cases (emergency worker, etc.)
// =============================================================================

import { prisma } from '#config/prisma.js';
import { logger } from '#config/logger.js';

// =============================================================================
// TOKEN LOOKUP
// =============================================================================

/**
 * Find a token by UUID for scan resolution.
 * Single query with all required joins.
 * Called only on Redis cache miss.
 *
 * @param {string} tokenId
 * @returns {object|null}
 */
export const findTokenForScan = async tokenId => {
  return prisma.token.findUnique({
    where: { id: tokenId },
    select: {
      id: true,
      status: true,
      expires_at: true,
      school_id: true,
      student_id: true,
      is_honeypot: true,

      school: {
        select: {
          id: true,
          name: true,
          code: true,
          logo_url: true,
          phone: true,
          address: true,
          settings: {
            select: {
              scan_notifications_enabled: true,
            },
          },
        },
      },

      student: {
        select: {
          id: true,
          first_name: true,
          last_name: true,
          photo_url: true,
          class: true,
          section: true,
          gender: true,
          setup_stage: true,
          is_active: true,

          parents: {
            select: {
              parent: {
                select: {
                  devices: {
                    where: { is_active: true },
                    select: {
                      expo_push_token: true,
                    },
                  },
                },
              },
            },
          },

          cardVisibility: {
            select: {
              visibility: true,
              hidden_fields: true,
            },
          },

          emergency: {
            select: {
              blood_group: true,
              allergies: true,
              conditions: true,
              medications: true,
              doctor_name: true,
              doctor_phone_encrypted: true,
              notes: true,
              visibility: true,
              is_visible: true,

              contacts: {
                where: { is_active: true },
                orderBy: { display_order: 'asc' },
                select: {
                  id: true,
                  name: true,
                  phone_encrypted: true,
                  relationship: true,
                  priority: true,
                  display_order: true,
                  call_enabled: true,
                  whatsapp_enabled: true,
                },
              },
            },
          },
        },
      },
    },
  });
};

// =============================================================================
// SCAN LOG (direct write — for non-hot-path callers like emergency worker)
// =============================================================================

/**
 * Write a scan log entry directly to DB.
 * For the hot path, use enqueueScanLog() from scan.cache.js instead.
 */
export const writeScanLog = ({
  tokenId,
  schoolId,
  result,
  ip,
  userAgent,
  deviceHash,
  latitude,
  longitude,
  responseTimeMs,
  scanPurpose,
}) =>
  prisma.scanLog
    .create({
      data: {
        token_id: tokenId,
        school_id: schoolId,
        result,
        scan_purpose: scanPurpose ?? 'QR_SCAN',
        ip_address: ip ?? null,
        user_agent: userAgent ?? null,
        device_hash: deviceHash ?? null,
        latitude: latitude ?? null,
        longitude: longitude ?? null,
        location_derived: latitude != null,
        response_time_ms: responseTimeMs ?? null,
        ip_capture_basis: 'LEGITIMATE_INTEREST',
      },
    })
    .catch(err => {
      logger.error(
        { err: err.message, tokenId, schoolId },
        '[scan.repository] writeScanLog failed'
      );
    });

// =============================================================================
// BULK SCAN LOG (used by scan.worker)
// =============================================================================

/**
 * Bulk insert scan log entries.
 * Called by scan.worker draining the Redis log queue every 5 seconds.
 */
export const bulkWriteScanLogs = async entries => {
  if (!entries.length) return;
  try {
    return await prisma.scanLog.createMany({
      data: entries,
    });
  } catch (err) {
    logger.error(
      { err: err.message, count: entries.length },
      '[scan.repository] bulkWriteScanLogs failed'
    );
    throw err;
  }
};
