// =============================================================================
// modules/scan/scan.service.js — RESQID
//
// Core logic for QR scan resolution.
//
// HOT PATH (cache hit):   decodeScanCode → Redis hit → respond           (~2ms)
// HOT PATH (cache miss):  decodeScanCode → DB → buildProfile → cache → respond (~15ms)
//
// ALWAYS ASYNC (never blocks response):
//   fireLog        → Redis log queue → scan.worker bulk-inserts to DB
//   evaluateAnomaly → Redis counters → anomaly worker writes ScanAnomaly
//   dispatch()     → notification worker → Expo push to parents
//
// SECURITY MEASURES:
//   [S1] decodeScanCode() AES-SIV verify before any DB touch
//   [S2] MIN_RESPONSE_MS = 150 timing floor — prevents timing oracle
//   [S3] Identical error shape for INVALID vs NOT_FOUND — no token existence leak
//   [S4] MIN_RESPONSE_BYTES padding — response size normalization
//   [S5] REVOKED/EXPIRED → state:'INACTIVE' — don't confirm token fate to attacker
//   [S6] photo_url → presigned URL generated fresh on every serve (5-min TTL safe)
//   [S7] Honeypot check after DB fetch — triggers anomaly with isHoneypot flag
//   [S8] Log fires BEFORE cache write — no unlogged poisoned cache entries
//   [S9] setup_stage checked — incomplete profiles never served as ACTIVE
// =============================================================================

import { performance } from 'perf_hooks';
import { decodeScanCode } from '#services/token/token.helpers.js';
import { decryptField } from '#shared/security/encryption.js';
import { getStorage } from '#infrastructure/storage/storage.index.js';
import { dispatch } from '#orchestrator/notifications/notification.dispatcher.js';
import { EVENTS } from '#orchestrator/events/event.types.js';
import { logger } from '#config/logger.js';
import * as repo from './scan.repository.js';
import { getCachedProfile, setCachedProfile, enqueueScanLog } from '#shared/cache/scan.cache.js';
import { evaluateAnomaly } from '#shared/anomaly/anomaly.evaluator.js';
import {
  maskPhone,
  isSuspiciousUserAgent,
  buildScanLogPayload,
  formatScanResponse,
  calculateResponseTime,
} from './scan.helper.js';

// =============================================================================
// CONSTANTS
// =============================================================================

const MIN_RESPONSE_MS = 150;
const MIN_RESPONSE_BYTES = 1500; // FIX: Empirically larger — full ACTIVE profile > 600 bytes

const SENTINEL_TOKEN_ID = '00000000-0000-0000-0000-000000000000';
const SENTINEL_SCHOOL_ID = '00000000-0000-0000-0000-000000000000';

// FIX: Photo key cached (not presigned URL) — presigned on every serve
//      This prevents serving expired presigned URLs from cache
const ACTIVE_PROFILE_CACHE_TTL_S = 300; // 5 min — matches presign TTL
const DEAD_STATE_CACHE_TTL_S = 3600; // 1 hour for inactive/expired/revoked

// =============================================================================
// MAIN — resolveScan
// =============================================================================

export const resolveScan = async ({
  code,
  ip,
  userAgent,
  deviceHash,
  startTime,
  scanCount = 1,
}) => {
  // ── 1. Decode + AES-SIV verify ────────────────────────────────────────────
  let tokenId;
  try {
    tokenId = decodeScanCode(code);
  } catch {
    fireLog(
      buildScanLogPayload({
        tokenId: SENTINEL_TOKEN_ID,
        schoolId: SENTINEL_SCHOOL_ID,
        result: 'INVALID',
        scanPurpose: 'QR_SCAN',
        ip,
        userAgent,
        deviceHash,
        startTime,
      })
    );
    setImmediate(() =>
      evaluateAnomaly({
        tokenId: SENTINEL_TOKEN_ID,
        schoolId: SENTINEL_SCHOOL_ID,
        ip,
        scanResult: 'INVALID',
        isSuspiciousUa: isSuspiciousUserAgent(userAgent),
      })
    );
    return respond(startTime, buildError('INVALID', 'This QR code could not be verified.'));
  }

  // ── 2. Redis cache check ───────────────────────────────────────────────────
  const cached = await getCachedProfile(tokenId);
  if (cached) {
    const schoolId = cached._schoolId ?? SENTINEL_SCHOOL_ID;
    const scanResult = cached.state === 'ACTIVE' ? 'SUCCESS' : cached.state;

    // FIX [S8]: Log before cache path response — same ordering as DB path
    fireLog(
      buildScanLogPayload({
        tokenId,
        schoolId,
        result: scanResult,
        scanPurpose: 'QR_SCAN',
        ip,
        userAgent,
        deviceHash,
        startTime,
      })
    );

    setImmediate(() => evaluateAnomaly({ tokenId, schoolId, ip, scanResult, scanCount }));

    // FIX: fireNotification now a proper defined function — no ReferenceError
    if (cached.state === 'ACTIVE') {
      fireNotification({
        schoolId,
        studentName: cached.profile?.name,
        parentExpoTokens: cached._parentTokens ?? [],
        notifyEnabled: cached._settings ?? false,
        studentId: cached._studentId ?? null,
        tokenId,
      });

      // FIX: Regenerate presigned photo URL on cache hit — cached._photoKey is
      //      the storage path, not the presigned URL (avoids 5-min TTL expiry)
      if (cached._photoKey && cached.profile) {
        try {
          cached.profile.photo_url = await getStorage().getUrl(cached._photoKey, 300);
        } catch {
          cached.profile.photo_url = null;
        }
      }
    }

    return respond(startTime, formatScanResponse(cached));
  }

  // ── 3. DB query ────────────────────────────────────────────────────────────
  const token = await repo.findTokenForScan(tokenId);

  if (!token) {
    fireLog(
      buildScanLogPayload({
        tokenId,
        schoolId: SENTINEL_SCHOOL_ID,
        result: 'INVALID',
        scanPurpose: 'QR_SCAN',
        ip,
        userAgent,
        deviceHash,
        startTime,
      })
    );
    setImmediate(() =>
      evaluateAnomaly({ tokenId, schoolId: SENTINEL_SCHOOL_ID, ip, scanResult: 'INVALID' })
    );
    return respond(startTime, buildError('INVALID', 'This QR code could not be verified.'));
  }

  const schoolId = token.school_id;

  // Extract push tokens from joined query — no extra DB call
  const parentExpoTokens = (token.student?.parents ?? [])
    .flatMap(p => p.parent?.devices?.map(d => d.expo_push_token) ?? [])
    .filter(Boolean);
  const scanNotificationsEnabled = token.school?.settings?.scan_notifications_enabled ?? false;

  // ── 4. Honeypot check ──────────────────────────────────────────────────────
  if (token.is_honeypot) {
    fireLog(
      buildScanLogPayload({
        tokenId,
        schoolId,
        result: 'INVALID',
        scanPurpose: 'HONEYPOT', // FIX: Use HONEYPOT purpose — exists in ScanPurpose enum
        ip,
        userAgent,
        deviceHash,
        startTime,
      })
    );
    setImmediate(() =>
      evaluateAnomaly({ tokenId, schoolId, ip, scanResult: 'INVALID', isHoneypot: true })
    );
    return respond(startTime, buildError('INVALID', 'This QR code could not be verified.'));
  }

  // ── 5. Token state checks ──────────────────────────────────────────────────

  if (token.expires_at && token.expires_at < new Date()) {
    const payload = {
      state: 'INACTIVE',
      school: safeSchoolMinimal(token.school),
      message: 'This card is no longer active. Please contact the school.',
    };
    // FIX [S8]: Log fires BEFORE cache write
    fireLog(
      buildScanLogPayload({
        tokenId,
        schoolId,
        result: 'EXPIRED',
        scanPurpose: 'QR_SCAN',
        ip,
        userAgent,
        deviceHash,
        startTime,
      })
    );
    setCachedProfile(tokenId, { ...payload, _schoolId: schoolId }, DEAD_STATE_CACHE_TTL_S);
    return respond(startTime, payload);
  }

  if (token.status === 'REVOKED') {
    const payload = {
      state: 'INACTIVE',
      school: safeSchoolMinimal(token.school),
      message: 'This card is no longer active. Please contact the school.',
    };
    fireLog(
      buildScanLogPayload({
        tokenId,
        schoolId,
        result: 'REVOKED',
        scanPurpose: 'QR_SCAN',
        ip,
        userAgent,
        deviceHash,
        startTime,
      })
    );
    setCachedProfile(tokenId, { ...payload, _schoolId: schoolId }, DEAD_STATE_CACHE_TTL_S);
    return respond(startTime, payload);
  }

  if (token.status === 'INACTIVE') {
    const payload = {
      state: 'INACTIVE',
      school: safeSchoolFull(token.school),
      message: 'This card is currently inactive. Please contact the school.',
    };
    // FIX: INACTIVE result — not SUCCESS
    fireLog(
      buildScanLogPayload({
        tokenId,
        schoolId,
        result: 'INACTIVE',
        scanPurpose: 'QR_SCAN',
        ip,
        userAgent,
        deviceHash,
        startTime,
      })
    );
    setCachedProfile(tokenId, { ...payload, _schoolId: schoolId }, DEAD_STATE_CACHE_TTL_S);
    return respond(startTime, payload);
  }

  // ── 6. UNASSIGNED ──────────────────────────────────────────────────────────
  if (token.status === 'UNASSIGNED' || !token.student_id) {
    const payload = {
      state: 'UNREGISTERED',
      school: safeSchoolFull(token.school),
      message: 'This card has not been registered yet. Please ask the parent to register.',
    };
    // FIX: UNREGISTERED result — not SUCCESS. Don't cache — status may change.
    fireLog(
      buildScanLogPayload({
        tokenId,
        schoolId,
        result: 'UNREGISTERED',
        scanPurpose: 'QR_SCAN',
        ip,
        userAgent,
        deviceHash,
        startTime,
      })
    );
    return respond(startTime, payload);
  }

  // ── 7. ISSUED ──────────────────────────────────────────────────────────────
  if (token.status === 'ISSUED') {
    const payload = {
      state: 'ISSUED',
      school: safeSchoolFull(token.school),
      message: 'This card has been issued but not yet activated by the family.',
    };
    // FIX: ISSUED result in log — matches ScanResult enum value
    fireLog(
      buildScanLogPayload({
        tokenId,
        schoolId,
        result: 'ISSUED',
        scanPurpose: 'QR_SCAN',
        ip,
        userAgent,
        deviceHash,
        startTime,
      })
    );
    setCachedProfile(tokenId, { ...payload, _schoolId: schoolId });
    return respond(startTime, payload);
  }

  // ── 8. ACTIVE token — validate student ────────────────────────────────────
  const student = token.student;

  if (!student || !student.is_active) {
    const payload = {
      state: 'INACTIVE',
      school: safeSchoolFull(token.school),
      message: 'This card is currently inactive.',
    };
    // FIX: STUDENT_INACTIVE → maps to INACTIVE ScanResult (closest valid enum)
    fireLog(
      buildScanLogPayload({
        tokenId,
        schoolId,
        result: 'INACTIVE',
        scanPurpose: 'QR_SCAN',
        ip,
        userAgent,
        deviceHash,
        startTime,
      })
    );
    setCachedProfile(tokenId, { ...payload, _schoolId: schoolId });
    return respond(startTime, payload);
  }

  // FIX [S9]: Check setup_stage — never serve an incomplete profile as ACTIVE
  if (student.setup_stage !== 'COMPLETE' && student.setup_stage !== 'VERIFIED') {
    const payload = {
      state: 'INACTIVE',
      school: safeSchoolFull(token.school),
      message: 'This card profile is not yet complete. Please ask the family to finish setup.',
    };
    fireLog(
      buildScanLogPayload({
        tokenId,
        schoolId,
        result: 'INACTIVE',
        scanPurpose: 'QR_SCAN',
        ip,
        userAgent,
        deviceHash,
        startTime,
      })
    );
    return respond(startTime, payload);
  }

  // ── 9. Build full ACTIVE profile ──────────────────────────────────────────
  const emergency = student.emergency;
  const visibility = emergency?.visibility ?? 'PUBLIC';
  const hiddenFields = student.cardVisibility?.hidden_fields ?? [];

  const { profile, photoKey } = await buildProfile({
    student,
    emergency,
    visibility,
    hiddenFields,
  });

  const payload = {
    state: 'ACTIVE',
    profile,
    school: safeSchoolFull(token.school),
  };

  // FIX [S8]: Log fires BEFORE cache write — guaranteed audit trail
  fireLog(
    buildScanLogPayload({
      tokenId,
      schoolId,
      studentId: student.id,
      result: 'SUCCESS',
      scanPurpose: 'QR_SCAN',
      ip,
      userAgent,
      deviceHash,
      startTime,
    })
  );

  // FIX: Cache stores photoKey (storage path), NOT the presigned URL
  //      Presigned URL is regenerated fresh on every cache hit
  const cachePayload = {
    ...payload,
    _schoolId: schoolId,
    _studentId: student.id,
    _parentTokens: parentExpoTokens,
    _settings: scanNotificationsEnabled,
    _photoKey: photoKey ?? null, // FIX: raw storage key, not presigned URL
  };
  setCachedProfile(tokenId, cachePayload, ACTIVE_PROFILE_CACHE_TTL_S);

  setImmediate(() => evaluateAnomaly({ tokenId, schoolId, ip, scanResult: 'SUCCESS', scanCount }));

  fireNotification({
    schoolId,
    studentName: profile.name,
    parentExpoTokens,
    notifyEnabled: scanNotificationsEnabled,
    studentId: student.id,
    tokenId,
  });

  return respond(startTime, payload);
};

// =============================================================================
// FIRE-AND-FORGET HELPERS
// =============================================================================

/**
 * Enqueue a scan log entry into Redis for bulk DB insert by scan.worker.
 * @param {object} logEntry — from buildScanLogPayload()
 */
const fireLog = logEntry => {
  enqueueScanLog(logEntry);
};

/**
 * FIX: Extracted notification dispatch as a named function.
 * Previously referenced as fireQrScannedNotification() but was never defined —
 * caused ReferenceError on every active cache hit.
 */
const fireNotification = ({
  schoolId,
  studentName,
  parentExpoTokens,
  notifyEnabled,
  studentId,
  tokenId,
}) => {
  if (!notifyEnabled || !parentExpoTokens?.length) return;

  setImmediate(async () => {
    try {
      await dispatch({
        type: EVENTS.STUDENT_QR_SCANNED,
        schoolId,
        payload: {
          studentName,
          location: null,
          parentExpoTokens,
          notifyEnabled: true,
        },
        meta: { studentId, tokenId },
      });
    } catch (err) {
      // FIX: Static import at top of file — no dynamic import in catch block
      logger.error({ err: err.message, studentId }, '[scan.service] notification dispatch failed');
    }
  });
};

// =============================================================================
// TIMING + PADDING
// =============================================================================

/**
 * Enforce timing floor and response size normalization.
 * FIX: Returns the actual padded result object — padding was previously
 *      applied to a string that was never used (result._ deleted before return).
 * FIX: Uses performance.now() delta via calculateResponseTime() — monotonic.
 *
 * @param {number} startTime — from performance.now()
 * @param {object} result
 * @returns {Promise<object>}
 */
const respond = async (startTime, result) => {
  // Size padding — add _ field to normalize response size
  const jsonLen = JSON.stringify(result).length;
  if (jsonLen < MIN_RESPONSE_BYTES) {
    // FIX: Keep _ in the returned object — controller's res.json() will serialize it
    // JSON parsers ignore unknown fields; client-side code ignores _ field
    result._ = ' '.repeat(MIN_RESPONSE_BYTES - jsonLen);
  }

  // Timing floor — prevents timing oracle attacks
  const elapsed = calculateResponseTime(startTime);
  const pad = Math.max(0, MIN_RESPONSE_MS - elapsed);
  if (pad > 0) await new Promise(resolve => setTimeout(resolve, pad));

  return result;
};

const buildError = (state, message) => ({ state, message });

// =============================================================================
// PROFILE ASSEMBLY
// =============================================================================

/**
 * Build the full ACTIVE student profile for the scan response.
 * FIX: Returns { profile, photoKey } — photoKey stored in cache separately
 *      from the presigned URL so it can be re-presigned on cache hits.
 */
const buildProfile = async ({ student, emergency, visibility, hiddenFields }) => {
  // FIX: Store the raw storage key — presign freshly on every serve
  let photoKey = null;
  let photoUrl = null;

  if (student.photo_url && !hiddenFields.includes('photo')) {
    photoKey = student.photo_url; // raw R2 key
    try {
      photoUrl = await getStorage().getUrl(photoKey, 300);
    } catch {
      photoUrl = null;
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
    return { profile: { ...base, visibility: 'HIDDEN' }, photoKey };
  }

  if (visibility === 'MINIMAL') {
    const primaryContact = getPrimaryContact(emergency?.contacts ?? []);
    return {
      profile: { ...base, visibility: 'MINIMAL', primary_contact: primaryContact },
      photoKey,
    };
  }

  // PUBLIC — full emergency info
  const profile = {
    ...base,
    visibility: 'PUBLIC',
    blood_group: formatBloodGroup(emergency?.blood_group),
    allergies: emergency?.allergies ?? null,
    conditions: emergency?.conditions ?? null,
    medications: emergency?.medications ?? null,
    doctor: emergency?.doctor_name
      ? {
          name: emergency.doctor_name,
          // FIX: Doctor phone masked — same as guardian contacts
          phone: maskPhone(safeDecrypt(emergency.doctor_phone_encrypted)),
        }
      : null,
    notes: emergency?.notes ?? null,
    contacts: buildContacts(emergency?.contacts ?? []),
  };

  return { profile, photoKey };
};

/**
 * Map emergency contacts to wire-safe shape.
 * FIX: contact.id removed — internal UUID has no use for scanner
 *      and is an enumerable internal identifier.
 */
const buildContacts = contacts =>
  contacts.map(c => ({
    // FIX: id removed from public response
    name: c.name,
    relationship: c.relationship ?? null,
    phone: maskPhone(safeDecrypt(c.phone_encrypted)),
    priority: c.priority,
    call_enabled: c.call_enabled,
    whatsapp_enabled: c.whatsapp_enabled,
  }));

/**
 * Get highest-priority contact for MINIMAL visibility.
 * FIX: Includes contact id so the backend call redirect endpoint
 *      can resolve it — id is NOT sent to the frontend,
 *      only used in backend href generation.
 */
const getPrimaryContact = contacts => {
  if (!contacts.length) return null;
  const primary = [...contacts].sort((a, b) => a.priority - b.priority)[0];
  return {
    id: primary.id, // kept for backend call redirect resolution
    name: primary.name,
    relationship: primary.relationship ?? null,
    phone: maskPhone(safeDecrypt(primary.phone_encrypted)),
    call_enabled: primary.call_enabled,
    whatsapp_enabled: primary.whatsapp_enabled,
  };
};

/**
 * Safely decrypt an encrypted field. Returns null on any failure.
 * Never throws — decrypt failure must not crash the scan response.
 */
const safeDecrypt = encrypted => {
  if (!encrypted) return null;
  try {
    return decryptField(encrypted);
  } catch {
    return null;
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

/**
 * FIX: Map-based blood group formatting — covers all BloodGroup enum values.
 * Previous replace() chain silently returned raw enum for unknown formats.
 */
const BLOOD_GROUP_DISPLAY = {
  A_POS: 'A+',
  A_NEG: 'A-',
  B_POS: 'B+',
  B_NEG: 'B-',
  AB_POS: 'AB+',
  AB_NEG: 'AB-',
  O_POS: 'O+',
  O_NEG: 'O-',
  UNKNOWN: 'Unknown',
};

const formatBloodGroup = bg => {
  if (!bg) return null;
  return BLOOD_GROUP_DISPLAY[bg] ?? bg; // fallback to raw value if new enum added
};
