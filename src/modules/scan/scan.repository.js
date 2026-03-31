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
import crypto from 'crypto';

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
      is_honeypot: true, // honeypot check before building any profile

      school: {
        select: {
          id: true,
          name: true,
          code: true,
          logo_url: true,
          phone: true,
          address: true,
        },
      },

      student: {
        select: {
          id: true,
          first_name: true,
          last_name: true,
          photo_url: true, // S3 key — presigned URL generated in service
          class: true,
          section: true,
          gender: true,
          setup_stage: true,
          is_active: true,

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
 * .catch(() => {}) is intentional — observability must never affect correctness.
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
    .catch(() => {});

// =============================================================================
// BULK SCAN LOG (used by scan.worker)
// =============================================================================

/**
 * Bulk insert scan log entries.
 * Called by scan.worker draining the Redis log queue every 5 seconds.
 * createMany skips duplicate conflicts rather than failing the whole batch.
 */
export const bulkWriteScanLogs = async entries => {
  if (!entries.length) return;
  return prisma.scanLog.createMany({
    data: entries,
    skipDuplicates: true,
  });
};

// =============================================================================
// REGISTRATION NONCE
// =============================================================================

export const findActiveNonce = async nonce => {
  return prisma.registrationNonce.findFirst({
    where: {
      nonce,
      used: false,
      expires_at: { gt: new Date() },
    },
    select: { id: true, token_id: true, expires_at: true },
  });
};

export const findActiveNonceByTokenId = async tokenId => {
  return prisma.registrationNonce.findFirst({
    where: {
      token_id: tokenId,
      used: false,
      expires_at: { gt: new Date() },
    },
    select: { nonce: true, expires_at: true },
  });
};

export const consumeNonce = async nonceId => {
  return prisma.registrationNonce.update({
    where: { id: nonceId },
    data: { used: true, used_at: new Date() },
  });
};

export const createRegistrationNonce = async tokenId => {
  const nonce = crypto.randomUUID().replace(/-/g, '');
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

  await prisma.registrationNonce.create({
    data: { nonce, token_id: tokenId, expires_at: expiresAt },
  });

  return { nonce, expiresAt };
};
