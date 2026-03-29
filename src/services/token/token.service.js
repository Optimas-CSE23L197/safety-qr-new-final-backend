// =============================================================================
// services/token/token.service.js — RESQID
// Token service — scan resolution and token state validation.
// All crypto helpers live in token.helpers.js and are re-exported from here.
//
// FIXED:
//   [C-5] require() replaced with ESM import — was crashing at runtime
//   [C-6] Duplicate helper functions removed — re-exported from token.helpers.js
//   [M-8] batchGenerateTokensAndCards removed — replaced by token.handler.js
//         which uses parallel chunk processing (BATCH_SIZE=20)
// =============================================================================

import { prisma } from '#config/prisma.js';
import { logger } from '#config/logger.js';
import { decrypt } from '#shared/security/encryption.js';

// Re-export all helpers as authoritative source — no duplicates
export {
  generateRawToken,
  hashRawToken,
  generateCardNumber,
  batchGenerateCardNumbers,
  generateBlankCardNumber,
  buildScanUrl,
  generateScanCode,
  decodeScanCode,
  calculateExpiry,
  resolveBranding,
  toQrTypeEnum,
  ScanCodeError,
} from './token.helpers.js';

import { decodeScanCode, ScanCodeError } from './token.helpers.js';

// =============================================================================
// SCAN RESOLUTION (Public scan API)
// Uses select instead of include — only fetches fields needed for the response.
// =============================================================================

/**
 * Resolve a scan code to token, student, and emergency profile data.
 * Cryptographic verification happens in decodeScanCode — DB is never
 * touched for invalid or forged codes.
 *
 * @param {string} scanCode — 43-char base62 code from URL
 * @returns {Promise<{ token, school, student, emergency }>}
 */
export const resolveScanCode = async scanCode => {
  // 1. Decode + verify scan code (AES-SIV) — throws ScanCodeError if invalid
  let tokenId;
  try {
    tokenId = decodeScanCode(scanCode);
  } catch (err) {
    if (err instanceof ScanCodeError) throw new Error(`Invalid scan code: ${err.reason}`);
    throw err;
  }

  // 2. Fetch token with only the fields we actually need (not include: { student: true })
  const token = await prisma.token.findUnique({
    where: { id: tokenId },
    select: {
      id: true,
      status: true,
      expires_at: true,
      school: {
        select: { id: true, name: true, logo_url: true, phone: true, address: true },
      },
      student: {
        select: {
          id: true,
          first_name: true,
          last_name: true,
          photo_url: true,
          class: true,
          section: true,
          cardVisibility: { select: { visibility: true } },
          emergency: {
            select: {
              blood_group: true,
              allergies: true,
              conditions: true,
              medications: true,
              notes: true,
              contacts: {
                where: { is_active: true },
                orderBy: { priority: 'asc' },
                select: {
                  name: true,
                  relationship: true,
                  priority: true,
                  phone_encrypted: true,
                  call_enabled: true,
                  whatsapp_enabled: true,
                },
              },
              doctor_name: true,
              doctor_phone_encrypted: true,
            },
          },
        },
      },
    },
  });

  if (!token) throw new Error('Token not found');

  // 3. Validate token state
  const validation = validateTokenState(token);
  if (!validation.valid) throw new Error(validation.reason);

  // 4. Build response with visibility rules
  const profile = buildEmergencyProfile(token.student, token.student?.emergency);

  return {
    token: {
      id: token.id,
      status: token.status,
      expires_at: token.expires_at,
    },
    school: {
      name: token.school?.name,
      logo_url: token.school?.logo_url,
      phone: token.school?.phone,
      address: token.school?.address,
    },
    student: token.student
      ? {
          name: `${token.student.first_name ?? ''} ${token.student.last_name ?? ''}`.trim(),
          photo_url: token.student.photo_url,
          class: token.student.class,
          section: token.student.section,
        }
      : null,
    emergency: profile,
  };
};

// =============================================================================
// TOKEN STATE VALIDATION
// =============================================================================

const validateTokenState = token => {
  if (!token) return { valid: false, reason: 'NOT_FOUND' };
  if (token.status === 'REVOKED') return { valid: false, reason: 'REVOKED' };
  if (token.status === 'EXPIRED') return { valid: false, reason: 'EXPIRED' };
  if (token.status === 'INACTIVE') return { valid: false, reason: 'INACTIVE' };
  if (token.status !== 'ACTIVE') return { valid: false, reason: 'INVALID' };
  if (token.expires_at && token.expires_at < new Date()) return { valid: false, reason: 'EXPIRED' };
  return { valid: true, reason: null };
};

// =============================================================================
// EMERGENCY PROFILE BUILDER
// =============================================================================

/**
 * Build emergency profile with visibility rules applied.
 * PUBLIC: full profile including contacts and doctor.
 * MINIMAL: primary contact only.
 * HIDDEN: no data returned.
 *
 * @param {object} student
 * @param {object} emergency
 * @returns {object|null}
 */
const buildEmergencyProfile = (student, emergency) => {
  if (!student) return null;

  const visibility = emergency?.visibility ?? student?.cardVisibility?.visibility ?? 'PUBLIC';

  if (visibility === 'HIDDEN') {
    return { visibility: 'HIDDEN', message: 'Emergency information is hidden' };
  }

  const profile = {
    visibility,
    name: `${student.first_name ?? ''} ${student.last_name ?? ''}`.trim(),
    photo_url: student.photo_url,
    class: student.class,
    section: student.section,
  };

  if (visibility === 'PUBLIC' && emergency) {
    profile.blood_group = emergency.blood_group?.replace('_POS', '+').replace('_NEG', '-') ?? null;
    profile.allergies = emergency.allergies;
    profile.conditions = emergency.conditions;
    profile.medications = emergency.medications;
    profile.notes = emergency.notes;

    if (emergency.contacts?.length) {
      profile.contacts = emergency.contacts.map(c => ({
        name: c.name,
        relationship: c.relationship,
        phone: safeDecrypt(c.phone_encrypted),
        priority: c.priority,
        call_enabled: c.call_enabled,
        whatsapp_enabled: c.whatsapp_enabled,
      }));
    }

    if (emergency.doctor_name) {
      profile.doctor = {
        name: emergency.doctor_name,
        phone: safeDecrypt(emergency.doctor_phone_encrypted),
      };
    }
  } else if (visibility === 'MINIMAL' && emergency?.contacts?.length) {
    const primary = emergency.contacts.find(c => c.priority === 1) ?? emergency.contacts[0];
    profile.primary_contact = {
      name: primary.name,
      relationship: primary.relationship,
      phone: safeDecrypt(primary.phone_encrypted),
    };
  }

  return profile;
};

// [C-5 FIXED] Using imported decrypt — no require()
const safeDecrypt = encrypted => {
  if (!encrypted) return null;
  try {
    return decrypt(encrypted);
  } catch (err) {
    logger.warn({ err: err.message }, '[token.service] Failed to decrypt field');
    return null;
  }
};
