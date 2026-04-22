// =============================================================================
// modules/scan/scan.service.js — RESQID
//
// Core logic for QR scan resolution with precise GPS location support
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
const MIN_RESPONSE_BYTES = 1500;

const SENTINEL_TOKEN_ID = '00000000-0000-0000-0000-000000000000';
const SENTINEL_SCHOOL_ID = '00000000-0000-0000-0000-000000000000';

const ACTIVE_PROFILE_CACHE_TTL_S = 300;
const DEAD_STATE_CACHE_TTL_S = 3600;

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
  latitude = null,
  longitude = null,
  accuracy = null,
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
        latitude,
        longitude,
        accuracy,
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
        latitude,
        longitude,
        accuracy,
      })
    );

    setImmediate(() => evaluateAnomaly({ tokenId, schoolId, ip, scanResult, scanCount }));

    // 🟢 FIX: Clone cached payload before mutating
    const responsePayload = formatScanResponse(cached);

    if (cached.state === 'ACTIVE') {
      fireNotification({
        schoolId,
        studentName: cached.profile?.name,
        parentExpoTokens: cached._parentTokens ?? [],
        notifyEnabled: cached._settings ?? false,
        studentId: cached._studentId ?? null,
        tokenId,
      });

      // 🟢 FIX: Generate fresh signed URL for photo on every request
      if (cached._photoKey && responsePayload.profile) {
        try {
          responsePayload.profile.photo_url = await getStorage().getUrl(cached._photoKey, 300);
        } catch (err) {
          logger.warn(
            { err: err.message, key: cached._photoKey },
            '[scan.service] Failed to generate photo URL'
          );
          responsePayload.profile.photo_url = null;
        }
      }
    }

    return respond(startTime, responsePayload);
  }

  // ── 3. DB query ────────────────────────────────────────────────────────────
  const token = await repo.findTokenForScan(tokenId);

  if (!token) {
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
        latitude,
        longitude,
        accuracy,
      })
    );
    setImmediate(() => evaluateAnomaly({ tokenId: SENTINEL_SCHOOL_ID, ip, scanResult: 'INVALID' }));
    return respond(startTime, buildError('INVALID', 'This QR code could not be verified.'));
  }

  const schoolId = token.school_id;

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
        scanPurpose: 'HONEYPOT',
        ip,
        userAgent,
        deviceHash,
        startTime,
        latitude,
        longitude,
        accuracy,
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
        latitude,
        longitude,
        accuracy,
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
        latitude,
        longitude,
        accuracy,
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
        latitude,
        longitude,
        accuracy,
      })
    );
    setCachedProfile(tokenId, { ...payload, _schoolId: schoolId }, DEAD_STATE_CACHE_TTL_S);
    return respond(startTime, payload);
  }

  if (token.status === 'UNASSIGNED' || !token.student_id) {
    const payload = {
      state: 'UNREGISTERED',
      school: safeSchoolFull(token.school),
      message: 'This card has not been registered yet. Please ask the parent to register.',
    };
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
        latitude,
        longitude,
        accuracy,
      })
    );
    return respond(startTime, payload);
  }

  if (token.status === 'ISSUED') {
    const payload = {
      state: 'ISSUED',
      school: safeSchoolFull(token.school),
      message: 'This card has been issued but not yet activated by the family.',
    };
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
        latitude,
        longitude,
        accuracy,
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
        latitude,
        longitude,
        accuracy,
      })
    );
    setCachedProfile(tokenId, { ...payload, _schoolId: schoolId });
    return respond(startTime, payload);
  }

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
        latitude,
        longitude,
        accuracy,
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
    visibility: visibility,
    hidden_fields: hiddenFields,
  };

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
      latitude,
      longitude,
      accuracy,
    })
  );

  const cachePayload = {
    ...payload,
    _schoolId: schoolId,
    _studentId: student.id,
    _parentTokens: parentExpoTokens,
    _settings: scanNotificationsEnabled,
    _photoKey: photoKey ?? null,
    visibility: visibility,
    hidden_fields: hiddenFields,
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

const fireLog = logEntry => {
  enqueueScanLog(logEntry).catch(err =>
    logger.error({ err: err.message, entry: logEntry }, '[scan.service] fireLog failed')
  );
};

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
      logger.error({ err: err.message, studentId }, '[scan.service] notification dispatch failed');
    }
  });
};

// =============================================================================
// TIMING + PADDING
// =============================================================================

const respond = async (startTime, result) => {
  const jsonLen = JSON.stringify(result).length;
  if (jsonLen < MIN_RESPONSE_BYTES) {
    result._ = ' '.repeat(MIN_RESPONSE_BYTES - jsonLen);
  }

  const elapsed = calculateResponseTime(startTime);
  const pad = Math.max(0, MIN_RESPONSE_MS - elapsed);
  if (pad > 0) await new Promise(resolve => setTimeout(resolve, pad));

  return result;
};

const buildError = (state, message) => ({ state, message });

// =============================================================================
// PROFILE ASSEMBLY
// =============================================================================

const buildProfile = async ({ student, emergency, visibility, hiddenFields }) => {
  let photoKey = null;
  let photoUrl = null;

  if (student.photo_url && !hiddenFields.includes('photo')) {
    photoKey = student.photo_url;
    try {
      photoUrl = await getStorage().getUrl(photoKey, 300);
    } catch (err) {
      logger.warn(
        { err: err.message, key: photoKey },
        '[scan.service] Failed to generate photo URL'
      );
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
          phone: maskPhone(safeDecrypt(emergency.doctor_phone_encrypted)),
        }
      : null,
    notes: emergency?.notes ?? null,
    contacts: buildContacts(emergency?.contacts ?? []),
  };

  return { profile, photoKey };
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
    id: primary.id,
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
  return BLOOD_GROUP_DISPLAY[bg] ?? bg;
};
