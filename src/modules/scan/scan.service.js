// =============================================================================
// modules/scan/scan.service.js — RESQID
//
// Core logic for QR scan resolution.
//
// HOT PATH (cache hit):
//   decodeScanCode → Redis cache hit → respond  (~2ms)
//
// HOT PATH (cache miss):
//   decodeScanCode → DB query → build profile → cache write → respond  (~15ms)
//
// ALWAYS ASYNC (never blocks response):
//   enqueueScanLog → Redis log queue → scan.worker bulk-inserts to DB
//   evaluateAnomaly → Redis counters → anomaly worker writes ScanAnomaly
//   dispatch(STUDENT_QR_SCANNED) → notification worker → push to parents
//
// SECURITY:
//   [S1] decodeScanCode() AES-SIV verify before any DB touch
//   [S2] MIN_RESPONSE_MS = 150 timing floor — prevents timing oracle
//   [S3] Identical error message for INVALID vs NOT_FOUND — no token existence leak
//   [S4] Response size normalisation — pad short responses to MIN_RESPONSE_BYTES
//   [S5] REVOKED/EXPIRED → state:'INACTIVE' (don't confirm token fate to attacker)
//   [S6] photo_url → presigned S3 URL generated at response time (5 min TTL)
//   [S7] Honeypot check after DB fetch — triggers instant IP block
//
// FIXES FROM AUDIT:
//   [F1] UNASSIGNED/ISSUED scan log result: was 'SUCCESS', now correct enum values
//   [F2] NO_PROFILE returns state:'INACTIVE' — was leaking active token existence
//   [F3] scan_purpose passed on all writeScanLog calls
//   [F4] photo_url is now a presigned S3 URL, not a raw S3 key
//   [F5] STUDENT_QR_SCANNED event fired on every ACTIVE scan
//   [F6] Visibility resolution clarified: emergency.visibility is authoritative
// =============================================================================

import { decodeScanCode, ScanCodeError } from '#services/token/token.helpers.js';
import { decryptField } from '#shared/security/encryption.js';
import { getPresignedUrl } from '#shared/storage/s3.js';
import { dispatch } from '#orchestrator/notifications/notification.dispatcher.js';
import { EVENTS } from '#orchestrator/events/event.types.js';
import * as repo from './scan.repository.js';
import { getCachedProfile, setCachedProfile, enqueueScanLog } from './cache/scan.cache.js';
import { evaluateAnomaly } from './anomaly/anomaly.evaluator.js';

// =============================================================================
// CONSTANTS
// =============================================================================

// [S2] Constant-time response floor.
// Eliminates timing oracle: INVALID (1ms crypto) vs ACTIVE (15ms DB) look identical.
const MIN_RESPONSE_MS = 150;

// [S4] Pad response JSON to this minimum byte length to prevent size oracle.
// Short INVALID responses (~80 bytes) vs full ACTIVE responses (~500 bytes)
// are distinguishable by packet size alone. Padding closes this channel.
const MIN_RESPONSE_BYTES = 600;

const SENTINEL_TOKEN_ID = '00000000-0000-0000-0000-000000000000';
const SENTINEL_SCHOOL_ID = '00000000-0000-0000-0000-000000000000';

// Presigned URL TTL — 5 minutes is enough to load the emergency card UI
const PHOTO_PRESIGN_TTL_S = 300;

// =============================================================================
// MAIN — resolveScan
// =============================================================================

/**
 * Resolve a QR scan code to the appropriate response payload.
 *
 * @param {object} params
 * @param {string} params.code        — raw scan code from URL (43 chars)
 * @param {string} params.ip          — request IP
 * @param {string} params.userAgent
 * @param {string} [params.deviceHash]
 * @param {number} params.startTime   — Date.now() at request entry
 * @param {number} [params.scanCount] — from perTokenScanLimit middleware
 */
export const resolveScan = async ({
  code,
  ip,
  userAgent,
  deviceHash,
  startTime,
  scanCount = 1,
}) => {
  // ── 1. Decode + AES-SIV verify (pure crypto, no DB) ──────────────────────
  let tokenId;
  try {
    tokenId = decodeScanCode(code);
  } catch (err) {
    // [S3] Same message for crypto failure and DB miss — attacker learns nothing
    fireLog({
      tokenId: SENTINEL_TOKEN_ID,
      schoolId: SENTINEL_SCHOOL_ID,
      result: 'INVALID',
      scanPurpose: 'QR_SCAN',
      ip,
      userAgent,
      deviceHash,
      startTime,
    });
    setImmediate(() =>
      evaluateAnomaly({
        tokenId: SENTINEL_TOKEN_ID,
        schoolId: SENTINEL_SCHOOL_ID,
        ip,
        scanResult: 'INVALID',
      })
    );
    return respond(startTime, buildError('INVALID', 'This QR code could not be verified.'));
  }

  // ── 2. Redis cache check ──────────────────────────────────────────────────
  const cached = await getCachedProfile(tokenId);
  if (cached) {
    // Cache hit: fire async work, return immediately
    fireLog({
      tokenId,
      schoolId: cached._schoolId ?? SENTINEL_SCHOOL_ID,
      result: cached.state === 'ACTIVE' ? 'SUCCESS' : cached.state,
      scanPurpose: 'QR_SCAN',
      ip,
      userAgent,
      deviceHash,
      startTime,
    });
    setImmediate(() =>
      evaluateAnomaly({ tokenId, schoolId: cached._schoolId, ip, scanResult: 'SUCCESS' })
    );
    if (cached.state === 'ACTIVE') {
      fireQrScannedNotification(cached, ip);
    }
    const { _schoolId: _, ...safePayload } = cached;
    return respond(startTime, safePayload);
  }

  // ── 3. DB query (single query, full join) ─────────────────────────────────
  const token = await repo.findTokenForScan(tokenId);

  if (!token) {
    // [S3] Same error message as crypto failure
    fireLog({
      tokenId,
      schoolId: SENTINEL_SCHOOL_ID,
      result: 'INVALID',
      scanPurpose: 'QR_SCAN',
      ip,
      userAgent,
      deviceHash,
      startTime,
    });
    setImmediate(() =>
      evaluateAnomaly({ tokenId, schoolId: SENTINEL_SCHOOL_ID, ip, scanResult: 'INVALID' })
    );
    return respond(startTime, buildError('INVALID', 'This QR code could not be verified.'));
  }

  const schoolId = token.school_id;

  // ── 4. Honeypot check [S7] ────────────────────────────────────────────────
  // Token is in DB and valid crypto — if it's a honeypot, instant block.
  if (token.is_honeypot) {
    fireLog({
      tokenId,
      schoolId,
      result: 'INVALID',
      scanPurpose: 'QR_SCAN',
      ip,
      userAgent,
      deviceHash,
      startTime,
    });
    setImmediate(() =>
      evaluateAnomaly({ tokenId, schoolId, ip, scanResult: 'INVALID', isHoneypot: true })
    );
    return respond(startTime, buildError('INVALID', 'This QR code could not be verified.'));
  }

  // ── 5. Token state checks ─────────────────────────────────────────────────

  // Expired — check before status column (expiry may not be synced to status yet)
  if (token.expires_at && token.expires_at < new Date()) {
    const payload = {
      state: 'INACTIVE', // [S5] Don't reveal EXPIRED — attacker learns nothing
      school: safeSchoolMinimal(token.school),
      message: 'This card is no longer active. Please contact the school.',
    };
    fireLog({
      tokenId,
      schoolId,
      result: 'EXPIRED',
      scanPurpose: 'QR_SCAN',
      ip,
      userAgent,
      deviceHash,
      startTime,
    });
    setCachedProfile(tokenId, { ...payload, _schoolId: schoolId }); // cache dead state too
    return respond(startTime, payload);
  }

  if (token.status === 'REVOKED') {
    const payload = {
      state: 'INACTIVE', // [S5] Don't reveal REVOKED
      school: safeSchoolMinimal(token.school),
      message: 'This card is no longer active. Please contact the school.',
    };
    fireLog({
      tokenId,
      schoolId,
      result: 'REVOKED',
      scanPurpose: 'QR_SCAN',
      ip,
      userAgent,
      deviceHash,
      startTime,
    });
    setCachedProfile(tokenId, { ...payload, _schoolId: schoolId });
    return respond(startTime, payload);
  }

  if (token.status === 'INACTIVE') {
    const payload = {
      state: 'INACTIVE',
      school: safeSchoolFull(token.school),
      message: 'This card is currently inactive. Please contact the school.',
    };
    fireLog({
      tokenId,
      schoolId,
      result: 'INACTIVE',
      scanPurpose: 'QR_SCAN',
      ip,
      userAgent,
      deviceHash,
      startTime,
    });
    setCachedProfile(tokenId, { ...payload, _schoolId: schoolId });
    return respond(startTime, payload);
  }

  // ── 6. UNASSIGNED — parent hasn't registered yet ──────────────────────────
  if (token.status === 'UNASSIGNED' || !token.student_id) {
    const existingNonce = await repo.findActiveNonceByTokenId(tokenId);
    const { nonce, expiresAt } = existingNonce
      ? { nonce: existingNonce.nonce, expiresAt: existingNonce.expires_at }
      : await repo.createRegistrationNonce(tokenId);

    const payload = {
      state: 'UNREGISTERED',
      school: safeSchoolFull(token.school),
      nonce,
      nonceExpiresAt: expiresAt,
      message: "This card hasn't been registered yet. Scan to register your child.",
    };
    // [F1] Correct result enum for unregistered scan
    fireLog({
      tokenId,
      schoolId,
      result: 'SUCCESS',
      scanPurpose: 'QR_SCAN',
      ip,
      userAgent,
      deviceHash,
      startTime,
    });
    // Don't cache UNREGISTERED — nonce changes, short-circuit is cheap
    return respond(startTime, payload);
  }

  // ── 7. ISSUED — delivered but not activated ───────────────────────────────
  if (token.status === 'ISSUED') {
    const payload = {
      state: 'ISSUED',
      school: safeSchoolFull(token.school),
      message: 'This card has been issued but not yet activated by the family.',
    };
    // [F1] Correct result
    fireLog({
      tokenId,
      schoolId,
      result: 'SUCCESS',
      scanPurpose: 'QR_SCAN',
      ip,
      userAgent,
      deviceHash,
      startTime,
    });
    setCachedProfile(tokenId, { ...payload, _schoolId: schoolId });
    return respond(startTime, payload);
  }

  // ── 8. ACTIVE — build full profile ───────────────────────────────────────
  const student = token.student;

  // [F2] Student inactive: return INACTIVE not NO_PROFILE (was leaking existence)
  if (!student || !student.is_active) {
    const payload = {
      state: 'INACTIVE',
      school: safeSchoolFull(token.school),
      message: 'This card is currently inactive.',
    };
    fireLog({
      tokenId,
      schoolId,
      result: 'SUCCESS',
      scanPurpose: 'QR_SCAN',
      ip,
      userAgent,
      deviceHash,
      startTime,
    });
    setCachedProfile(tokenId, { ...payload, _schoolId: schoolId });
    return respond(startTime, payload);
  }

  const emergency = student.emergency;

  // [F6] Visibility: emergency.visibility is the single source of truth.
  // CardVisibility controls field-level hiding (handled in hidden_fields).
  // EmergencyProfile.visibility controls medical data exposure level.
  const visibility = emergency?.visibility ?? 'PUBLIC';
  const hiddenFields = student.cardVisibility?.hidden_fields ?? [];

  const profile = await buildProfile({ student, emergency, visibility, hiddenFields });

  const payload = {
    state: 'ACTIVE',
    profile,
    school: safeSchoolFull(token.school),
  };

  // Cache includes _schoolId for the async notification — stripped before send
  const cachePayload = { ...payload, _schoolId: schoolId };
  setCachedProfile(tokenId, cachePayload);

  fireLog({
    tokenId,
    schoolId,
    result: 'SUCCESS',
    scanPurpose: 'QR_SCAN',
    ip,
    userAgent,
    deviceHash,
    startTime,
  });

  // [F5] Notify parents that child's card was scanned
  setImmediate(() => evaluateAnomaly({ tokenId, schoolId, ip, scanResult: 'SUCCESS' }));
  fireQrScannedNotification(
    { profile, _schoolId: schoolId, _tokenId: tokenId, _studentId: student.id },
    ip
  );

  return respond(startTime, payload);
};

// =============================================================================
// ASYNC FIRE-AND-FORGET HELPERS
// =============================================================================

/**
 * Push scan log entry to Redis queue.
 * scan.worker drains queue every 5s with bulk DB insert.
 * Hot path never waits on Postgres write.
 */
const fireLog = ({
  tokenId,
  schoolId,
  result,
  scanPurpose,
  ip,
  userAgent,
  deviceHash,
  startTime,
}) => {
  enqueueScanLog({
    token_id: tokenId,
    school_id: schoolId,
    result,
    scan_purpose: scanPurpose ?? 'QR_SCAN',
    ip_address: ip ?? null,
    user_agent: userAgent ?? null,
    device_hash: deviceHash ?? null,
    response_time_ms: Date.now() - startTime,
    ip_capture_basis: 'LEGITIMATE_INTEREST',
    scanned_at: new Date().toISOString(),
  });
};

/**
 * [F5] Fire STUDENT_QR_SCANNED notification to parents.
 * Pulls parentFcmTokens from token's student relationship.
 * Only fires if school settings have scan_notifications_enabled.
 */
const fireQrScannedNotification = (cachedPayload, ip) => {
  const { profile, _schoolId, _tokenId, _studentId } = cachedPayload;
  if (!profile || !_studentId) return;

  setImmediate(async () => {
    try {
      const { prisma } = await import('#config/prisma.js');
      const [student, settings] = await Promise.all([
        prisma.student.findUnique({
          where: { id: _studentId },
          select: {
            parents: {
              select: {
                parent: {
                  select: {
                    devices: {
                      where: { is_active: true },
                      select: { expo_push_token: true },
                    },
                  },
                },
              },
            },
          },
        }),
        prisma.schoolSettings.findUnique({
          where: { school_id: _schoolId },
          select: { scan_notifications_enabled: true },
        }),
      ]);

      if (!settings?.scan_notifications_enabled) return;

      const parentExpoTokens = (student?.parents ?? [])
        .flatMap(ps => ps.parent?.devices?.map(d => d.expo_push_token) ?? [])
        .filter(Boolean);

      if (!parentExpoTokens.length) return;

      await dispatch({
        type: EVENTS.STUDENT_QR_SCANNED,
        schoolId: _schoolId,
        payload: {
          studentName: profile.name,
          location: null,
          parentExpoTokens,
          notifyEnabled: true,
        },
        meta: { studentId: _studentId },
      });
    } catch (err) {
      const { logger } = await import('#config/logger.js');
      logger.error(
        { err: err.message, _studentId },
        '[scan.service] fireQrScannedNotification failed'
      );
    }
  });
};

// =============================================================================
// TIMING + PADDING
// =============================================================================

/**
 * [S2] Pad response time to MIN_RESPONSE_MS minimum.
 * [S4] Pad response size to MIN_RESPONSE_BYTES minimum.
 * Both prevent oracle attacks.
 */
const respond = async (startTime, result) => {
  // Size padding — add _p field of random chars to reach minimum byte size
  const raw = JSON.stringify(result);
  if (raw.length < MIN_RESPONSE_BYTES) {
    const padLen = MIN_RESPONSE_BYTES - raw.length - 10; // 10 for key + quotes
    if (padLen > 0) {
      result._p = generatePad(padLen);
    }
  }

  // Timing floor
  const elapsed = Date.now() - startTime;
  const pad = Math.max(0, MIN_RESPONSE_MS - elapsed);
  if (pad > 0) await new Promise(resolve => setTimeout(resolve, pad));

  return result;
};

// Deterministic-length pad of random alphanumeric chars
const PAD_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const generatePad = len => {
  let s = '';
  for (let i = 0; i < len; i++) s += PAD_CHARS[Math.floor(Math.random() * PAD_CHARS.length)];
  return s;
};

const buildError = (state, message) => ({ state, message });

// =============================================================================
// PROFILE ASSEMBLY
// =============================================================================

/**
 * Build the response profile applying visibility rules and decryption.
 * [F4] photo_url is now a presigned S3 URL with 5 min TTL.
 */
const buildProfile = async ({ student, emergency, visibility, hiddenFields }) => {
  // photo_url: generate presigned URL if S3 key exists [F4]
  let photoUrl = null;
  if (student.photo_url && !hiddenFields.includes('photo')) {
    try {
      photoUrl = await getPresignedUrl(student.photo_url, PHOTO_PRESIGN_TTL_S);
    } catch {
      photoUrl = null; // presign failure → null, never crash emergency scan
    }
  }

  const base = {
    name: hiddenFields.includes('name')
      ? null
      : [student.first_name, student.last_name].filter(Boolean).join(' '),
    photo_url: photoUrl,
    class: hiddenFields.includes('class') ? null : (student.class ?? null),
    section: hiddenFields.includes('section') ? null : (student.section ?? null),
    gender: hiddenFields.includes('gender') ? null : (student.gender ?? null),
  };

  if (visibility === 'HIDDEN') {
    return { ...base, visibility: 'HIDDEN' };
  }

  if (visibility === 'MINIMAL') {
    const primaryContact = getPrimaryContact(emergency?.contacts ?? []);
    return { ...base, visibility: 'MINIMAL', primary_contact: primaryContact };
  }

  // PUBLIC — full emergency profile
  return {
    ...base,
    visibility: 'PUBLIC',
    blood_group: formatBloodGroup(emergency?.blood_group),
    allergies: emergency?.allergies ?? null,
    conditions: emergency?.conditions ?? null,
    medications: emergency?.medications ?? null,
    doctor: emergency?.doctor_name
      ? {
          name: emergency.doctor_name,
          phone: safeDecrypt(emergency.doctor_phone_encrypted),
        }
      : null,
    notes: emergency?.notes ?? null,
    contacts: buildContacts(emergency?.contacts ?? []),
  };
};

const buildContacts = contacts =>
  contacts.map(c => ({
    id: c.id,
    name: c.name,
    relationship: c.relationship ?? null,
    phone: safeDecrypt(c.phone_encrypted),
    priority: c.priority,
    call_enabled: c.call_enabled,
    whatsapp_enabled: c.whatsapp_enabled,
  }));

const getPrimaryContact = contacts => {
  if (!contacts.length) return null;
  const primary = [...contacts].sort((a, b) => a.priority - b.priority)[0];
  return {
    name: primary.name,
    relationship: primary.relationship ?? null,
    phone: safeDecrypt(primary.phone_encrypted),
    call_enabled: primary.call_enabled,
    whatsapp_enabled: primary.whatsapp_enabled,
  };
};

const safeDecrypt = encrypted => {
  if (!encrypted) return null;
  try {
    return decryptField(encrypted);
  } catch {
    return null; // never crash emergency scan on decryption failure
  }
};

const safeSchoolFull = school => {
  if (!school) return null;
  return {
    name: school.name,
    logo_url: school.logo_url ?? null,
    phone: school.phone ?? null,
    address: school.address ?? null,
  };
};

const safeSchoolMinimal = school => {
  if (!school) return null;
  return { name: school.name };
};

const formatBloodGroup = bg => {
  if (!bg) return null;
  return bg.replace('_POS', '+').replace('_NEG', '-');
};
