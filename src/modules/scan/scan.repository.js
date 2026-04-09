// =============================================================================
// modules/scan/scan.repository.js — RESQID
//
// All DB reads/writes for the public QR scan flow.
// Read-only for profile data. Write-only for ScanLog.
//
// QUERY STRATEGY:
//   Single indexed PK lookup: Token.id
//   All joins via FK relations — no raw SQL, no N+1
//   ScanLog write → Redis queue enqueue (hot path)
//   writeScanLog kept for edge cases (emergency worker fallback)
//   bulkWriteScanLogs called by scan.worker every 5 seconds
// =============================================================================

import { prisma } from '#config/prisma.js';
import { logger } from '#config/logger.js';

// =============================================================================
// findTokenForScan
// Single query — all required joins, called only on Redis cache miss.
// FIX: Student filtered by is_active at query level — no PII fetched for
//      inactive students before rejection.
// FIX: Device fetch capped with take+orderBy — prevents unbounded push tokens.
// =============================================================================

/**
 * Find a token by UUID for scan resolution.
 * @param {string} tokenId
 * @returns {Promise<object|null>}
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
          phone: true, // plaintext — school contact, intentionally public
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
          setup_stage: true, // FIX: checked in service before building profile
          is_active: true,

          parents: {
            select: {
              parent: {
                select: {
                  devices: {
                    where: { is_active: true },
                    // FIX: Cap devices per parent — prevent unbounded push tokens
                    // and duplicate notifications from old/reinstalled devices
                    take: 3,
                    orderBy: { last_seen_at: 'desc' },
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
              hidden_fields: true, // consumed by service — never forwarded raw
            },
          },

          emergency: {
            select: {
              blood_group: true,
              allergies: true,
              conditions: true,
              medications: true,
              doctor_name: true,
              // FIX: Renamed to signal encryption — consuming code must decrypt
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
                  // FIX: Renamed to signal encryption — consuming code must decrypt
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
// writeScanLog — direct DB write (non-hot-path: emergency worker fallback)
// FIX: Made explicitly async with try/catch — no implicit Promise footgun
// FIX: Uses buildScanLogPayload shape — consistent field names
// =============================================================================

/**
 * Write a single scan log entry directly to DB.
 * For the hot path, use enqueueScanLog() from scan.cache.js instead.
 * @param {object} entry — shape from buildScanLogPayload()
 * @returns {Promise<void>}
 */
export const writeScanLog = async entry => {
  try {
    await prisma.scanLog.create({ data: entry });
  } catch (err) {
    logger.error(
      { err: err.message, tokenId: entry.token_id, schoolId: entry.school_id },
      '[scan.repository] writeScanLog failed'
    );
    // Swallowed — log write failure must never crash the scan response
  }
};

// =============================================================================
// bulkWriteScanLogs — batch insert (called by scan.worker every 5 seconds)
// FIX: Array guard before .length access — null/undefined won't throw
// FIX: Per-entry validation filter — one bad entry won't kill the whole batch
// =============================================================================

/**
 * Bulk insert scan log entries.
 * Called by scan.worker draining the Redis log queue.
 * @param {object[]} entries
 * @returns {Promise<void>}
 */
export const bulkWriteScanLogs = async entries => {
  // FIX: Guard against null/undefined before .length
  if (!Array.isArray(entries) || entries.length === 0) return;

  // FIX: Filter out malformed entries — don't let one bad record kill the batch
  const valid = entries.filter(e => e && e.token_id && e.school_id && e.result);

  if (valid.length === 0) {
    logger.warn('[scan.repository] bulkWriteScanLogs: all entries invalid, skipping');
    return;
  }

  if (valid.length < entries.length) {
    logger.warn(
      { dropped: entries.length - valid.length },
      '[scan.repository] bulkWriteScanLogs: some entries dropped (missing required fields)'
    );
  }

  try {
    await prisma.scanLog.createMany({ data: valid });
  } catch (err) {
    logger.error(
      { err: err.message, count: valid.length },
      '[scan.repository] bulkWriteScanLogs failed'
    );
    throw err; // Re-throw — worker handles retry logic
  }
};
