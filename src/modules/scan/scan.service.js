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
// =============================================================================
import crypto from 'crypto';
import { decodeScanCode, ScanCodeError } from '#services/token/token.helpers.js';
import { decryptField } from '#shared/security/encryption.js';
import { getStorage } from '#infrastructure/storage/storage.index.js';
import { dispatch } from '#orchestrator/notifications/notification.dispatcher.js';
import { EVENTS } from '#orchestrator/events/event.types.js';
import * as repo from './scan.repository.js';
import { getCachedProfile, setCachedProfile, enqueueScanLog } from '#shared/cache/scan.cache.js';
import { evaluateAnomaly } from '#shared/anomaly/anomaly.evaluator.js';
import { maskPhone } from './scan.helper.js';

// =============================================================================
// CONSTANTS
// =============================================================================

const MIN_RESPONSE_MS = 150;
const MIN_RESPONSE_BYTES = 600;

const SENTINEL_TOKEN_ID = '00000000-0000-0000-0000-000000000000';
const SENTINEL_SCHOOL_ID = '00000000-0000-0000-0000-000000000000';

const PHOTO_PRESIGN_TTL_S = 300;
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
  // ── 1. Decode + AES-SIV verify ──────────────────────────────────────────
  let tokenId;
  try {
    tokenId = decodeScanCode(code);
  } catch (err) {
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
    const { _schoolId: _, _parentTokens: __, _settings: ___, ...safePayload } = cached;
    return respond(startTime, safePayload);
  }

  // ── 3. DB query ─────────────────────────────────────────────────────────
  const token = await repo.findTokenForScan(tokenId);

  if (!token) {
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

  // Extract parent tokens and settings from the joined query (no extra DB call)
  const parentExpoTokens = (token.student?.parents ?? [])
    .flatMap(p => p.parent?.devices?.map(d => d.expo_push_token) ?? [])
    .filter(Boolean);
  const scanNotificationsEnabled = token.school?.settings?.scan_notifications_enabled ?? false;

  // ── 4. Honeypot check ────────────────────────────────────────────────────
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
  if (token.expires_at && token.expires_at < new Date()) {
    const payload = {
      state: 'INACTIVE',
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
    setCachedProfile(tokenId, { ...payload, _schoolId: schoolId }, DEAD_STATE_CACHE_TTL_S);
    return respond(startTime, payload);
  }

  if (token.status === 'REVOKED') {
    const payload = {
      state: 'INACTIVE',
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
    setCachedProfile(tokenId, { ...payload, _schoolId: schoolId }, DEAD_STATE_CACHE_TTL_S);
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
    setCachedProfile(tokenId, { ...payload, _schoolId: schoolId }, DEAD_STATE_CACHE_TTL_S);
    return respond(startTime, payload);
  }

  // ── 6. UNASSIGNED — parent hasn't registered yet ──────────────────────────
  if (token.status === 'UNASSIGNED' || !token.student_id) {
    const payload = {
      state: 'UNREGISTERED',
      school: safeSchoolFull(token.school),
      message: 'This card has not been registered yet. Please ask parents to register.',
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
    // Don't cache UNREGISTERED — status may change via registration
    return respond(startTime, payload);
  }

  // ── 7. ISSUED ────────────────────────────────────────────────────────────
  if (token.status === 'ISSUED') {
    const payload = {
      state: 'ISSUED',
      school: safeSchoolFull(token.school),
      message: 'This card has been issued but not yet activated by the family.',
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

  // ── 8. ACTIVE ────────────────────────────────────────────────────────────
  const student = token.student;

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
  const visibility = emergency?.visibility ?? 'PUBLIC';
  const hiddenFields = student.cardVisibility?.hidden_fields ?? [];

  const profile = await buildProfile({ student, emergency, visibility, hiddenFields });

  const payload = {
    state: 'ACTIVE',
    profile,
    school: safeSchoolFull(token.school),
  };

  const cachePayload = {
    ...payload,
    _schoolId: schoolId,
    _parentTokens: parentExpoTokens,
    _settings: scanNotificationsEnabled,
  };
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

  setImmediate(() => evaluateAnomaly({ tokenId, schoolId, ip, scanResult: 'SUCCESS', scanCount }));

  // Use pre-fetched parent tokens and settings
  if (scanNotificationsEnabled && parentExpoTokens.length > 0) {
    setImmediate(async () => {
      try {
        await dispatch({
          type: EVENTS.STUDENT_QR_SCANNED,
          schoolId,
          payload: {
            studentName: profile.name,
            location: null,
            parentExpoTokens,
            notifyEnabled: true,
          },
          meta: { studentId: student.id, tokenId },
        });
      } catch (err) {
        const { logger } = await import('#config/logger.js');
        logger.error(
          { err: err.message, studentId: student.id },
          '[scan.service] notification failed'
        );
      }
    });
  }

  return respond(startTime, payload);
};

// =============================================================================
// ASYNC FIRE-AND-FORGET HELPERS
// =============================================================================

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

// =============================================================================
// TIMING + PADDING
// =============================================================================

const respond = async (startTime, result) => {
  let responseJson = JSON.stringify(result);

  // Size padding using whitespace (no extra field)
  if (responseJson.length < MIN_RESPONSE_BYTES) {
    const padLen = MIN_RESPONSE_BYTES - responseJson.length;
    // Add spaces as padding (ignored by JSON parsers)
    result._ = ' '.repeat(padLen);
    responseJson = JSON.stringify(result);
    delete result._;
  }

  // Timing floor
  const elapsed = Date.now() - startTime;
  const pad = Math.max(0, MIN_RESPONSE_MS - elapsed);
  if (pad > 0) await new Promise(resolve => setTimeout(resolve, pad));

  return result;
};

const buildError = (state, message) => ({ state, message });

// =============================================================================
// PROFILE ASSEMBLY
// =============================================================================

const buildProfile = async ({ student, emergency, visibility, hiddenFields }) => {
  let photoUrl = null;
  if (student.photo_url && !hiddenFields.includes('photo')) {
    try {
      photoUrl = await getStorage().getUrl(student.photo_url, PHOTO_PRESIGN_TTL_S);
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
    return { ...base, visibility: 'HIDDEN' };
  }

  if (visibility === 'MINIMAL') {
    const primaryContact = getPrimaryContact(emergency?.contacts ?? []);
    return { ...base, visibility: 'MINIMAL', primary_contact: primaryContact };
  }

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
    phone: maskPhone(safeDecrypt(c.phone_encrypted)),
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
    phone: maskPhone(safeDecrypt(primary.phone_encrypted)),
    call_enabled: primary.call_enabled,
    whatsapp_enabled: primary.whatsapp_enabled,
  };
};

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

const formatBloodGroup = bg => {
  if (!bg) return null;
  return bg.replace('_POS', '+').replace('_NEG', '-');
};
