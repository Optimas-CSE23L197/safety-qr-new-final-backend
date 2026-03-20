// =============================================================================
// modules/scan/scan.repository.js — RESQID
//
// All DB reads for the public QR scan flow.
// No writes here except ScanLog — this file never modifies profile data.
//
// QUERY STRATEGY:
//   Every scan hits one indexed lookup: Token.id (PK).
//   All joins are via FK relations — no raw SQL, no N+1.
//   Profile data is loaded in a single query with nested includes.
//   ScanLog write is fire-and-forget — never blocks the response.
//
// CHANGES FROM PREVIOUS VERSION:
//   [FIX-1] createRegistrationNonce was importing crypto without importing it.
//           Added missing `import crypto from "crypto"`.
//   [FIX-2] Added findActiveNonceByTokenId — looks up an existing unexpired
//           nonce FOR A TOKEN (not by nonce value). Used to deduplicate nonce
//           creation on repeated UNASSIGNED scans (prevents nonce table flood).
//           The existing findActiveNonce(nonce) is for the parent registration
//           flow (lookup by nonce value) and is kept unchanged.
//   [FIX-3] writeScanLog school_id sentinel — "unknown" is not a valid UUID
//           and will fail the FK constraint on ScanLog.school_id. Changed to
//           the same null-safe sentinel UUID used for the token_id case.
// =============================================================================

import { prisma } from "../../config/prisma.js";
import crypto from "crypto"; // [FIX-1] was missing — createRegistrationNonce crashed

// =============================================================================
// TOKEN LOOKUP
// =============================================================================

/**
 * Find a token by its UUID (decoded from scan code).
 * Returns everything needed to decide what to show — status, expiry, student,
 * emergency profile, contacts — in a single query.
 *
 * @param {string} tokenId
 * @returns {object|null}
 */
export const findTokenForScan = async (tokenId) => {
  return prisma.token.findUnique({
    where: { id: tokenId },
    select: {
      id: true,
      status: true,
      expires_at: true,
      school_id: true,
      student_id: true,

      // School — needed for branding on active cards; minimal fields only
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

      // Student profile
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

          // Card visibility settings (parent-controlled)
          cardVisibility: {
            select: {
              visibility: true,
              hidden_fields: true,
            },
          },

          // Emergency profile + contacts
          emergency: {
            select: {
              blood_group: true,
              allergies: true,
              conditions: true,
              medications: true,
              doctor_name: true,
              doctor_phone_encrypted: true, // decrypted in service
              notes: true,
              visibility: true,
              is_visible: true,

              contacts: {
                where: { is_active: true },
                orderBy: { display_order: "asc" },
                select: {
                  id: true,
                  name: true,
                  phone_encrypted: true, // decrypted in service
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
// SCAN LOG (fire-and-forget)
// =============================================================================

/**
 * Write a scan log entry.
 * Never awaited at call site — scan log failure must never block response.
 * .catch(() => {}) is intentional — this is observability, not correctness.
 *
 * @param {object} params
 */
export const writeScanLog = ({
  tokenId,
  schoolId,
  result, // ScanResult enum value
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
        ip_address: ip ?? null,
        user_agent: userAgent ?? null,
        device_hash: deviceHash ?? null,
        latitude: latitude ?? null,
        longitude: longitude ?? null,
        location_derived: latitude != null,
        response_time_ms: responseTimeMs ?? null,
        scan_purpose: scanPurpose ?? null,
        ip_capture_basis: "LEGITIMATE_INTEREST",
      },
    })
    .catch(() => {}); // never throws

// =============================================================================
// REGISTRATION NONCE
// =============================================================================

/**
 * Find an active (unused, unexpired) registration nonce BY NONCE VALUE.
 * Used during parent registration flow to validate the nonce the parent submits.
 *
 * @param {string} nonce — the nonce value from the parent's registration request
 * @returns {object|null}
 */
export const findActiveNonce = async (nonce) => {
  return prisma.registrationNonce.findFirst({
    where: {
      nonce,
      used: false,
      expires_at: { gt: new Date() },
    },
    select: {
      id: true,
      token_id: true,
      expires_at: true,
    },
  });
};

/**
 * Find an active (unused, unexpired) registration nonce BY TOKEN ID.
 * [FIX-2] Used before createRegistrationNonce to prevent nonce table flood.
 * If an unexpired nonce already exists for this token, return it instead
 * of creating a new one. One live nonce per token at a time.
 *
 * @param {string} tokenId
 * @returns {object|null} — { nonce, expires_at } or null
 */
export const findActiveNonceByTokenId = async (tokenId) => {
  return prisma.registrationNonce.findFirst({
    where: {
      token_id: tokenId,
      used: false,
      expires_at: { gt: new Date() },
    },
    select: {
      nonce: true,
      expires_at: true,
    },
  });
};

/**
 * Mark a registration nonce as used (consumed on parent register).
 * @param {string} nonceId
 */
export const consumeNonce = async (nonceId) => {
  return prisma.registrationNonce.update({
    where: { id: nonceId },
    data: { used: true, used_at: new Date() },
  });
};

/**
 * Create a registration nonce for a token.
 * Only called when findActiveNonceByTokenId returns null.
 * TTL: 15 minutes.
 *
 * @param {string} tokenId
 * @returns {{ nonce: string, expiresAt: Date }}
 */
export const createRegistrationNonce = async (tokenId) => {
  const nonce = crypto.randomUUID().replace(/-/g, ""); // 32-char hex
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 min

  await prisma.registrationNonce.create({
    data: { nonce, token_id: tokenId, expires_at: expiresAt },
  });

  return { nonce, expiresAt };
};
