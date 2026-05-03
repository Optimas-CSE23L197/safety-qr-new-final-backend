// =============================================================================
// modules/parents/parent.service.js — RESQID
// =============================================================================

import crypto from 'crypto';
import * as repo from './parent.repository.js';
import { encryptField, decryptField, hashForLookup } from '#shared/security/encryption.js';
import { prisma } from '#config/prisma.js';
import { redis } from '#config/redis.js';
import { logger } from '#config/logger.js';
import { cacheGet, cacheSet, cacheDel } from '#shared/cache/cache.js';
import { generateOtp, hashOtp } from '#services/otp.service.js';
import { getEmail } from '#infrastructure/email/email.index.js';
import { publishNotification } from '#orchestrator/notifications/notification.publisher.js';
import OtpParentEmail from '#templates/email/otp-parent.jsx';
import { sendParentWelcome } from '#modules/notification/notification.module.service.js';
import { getSms } from '#infrastructure/sms/sms.index.js';
import { invalidateScanCache } from '#shared/cache/scan.cache.js';

// ─── ApiError ─────────────────────────────────────────────────────────────────

class ApiError extends Error {
  constructor(message, statusCode = 400, code = 'ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

// ─── Audit logger ─────────────────────────────────────────────────────────────

const writeAuditLog = data => {
  logger.info({ ...data }, 'AUDIT');
};

// ─── Cache helpers ────────────────────────────────────────────────────────────

const HOME_KEY = id => `parent:home:${id}`;
const HOME_TTL = 5 * 60; // 5 minutes

async function cacheAside(key, ttl, fetchFn) {
  const cached = await cacheGet(key);
  if (cached !== null) return cached;
  const data = await fetchFn();
  if (data !== null && data !== undefined) await cacheSet(key, data, ttl);
  return data;
}

async function invalidateParentHome(parentId) {
  await cacheDel(HOME_KEY(parentId));
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

async function getParentContactInfo(parentId) {
  return prisma.parentUser.findUnique({
    where: { id: parentId },
    select: { email: true, phone: true, name: true },
  });
}

async function getStudentName(studentId) {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: { first_name: true, last_name: true },
  });
  if (!student) return 'Student';
  return `${student.first_name || ''} ${student.last_name || ''}`.trim() || 'Student';
}

async function getCardDetails(cardId) {
  return prisma.card.findUnique({
    where: { id: cardId },
    select: {
      card_number: true,
      student: {
        select: {
          id: true,
          first_name: true,
          last_name: true,
          school: { select: { id: true, name: true } },
        },
      },
    },
  });
}

function maskPhone(phone) {
  if (!phone) return 'Unknown';
  const last4 = phone.slice(-4);
  const prefix = phone.slice(0, 3);
  return `${prefix}****${last4}`;
}

function safeDecrypt(encrypted) {
  if (!encrypted) return null;
  try {
    return decryptField(encrypted);
  } catch {
    return null;
  }
}

// ─── GET /me ──────────────────────────────────────────────────────────────────

export async function getParentHomeData(parentId) {
  return cacheAside(HOME_KEY(parentId), HOME_TTL, () => fetchAndShape(parentId));
}

async function fetchAndShape(parentId) {
  const { parent, studentLinks, lastScan, anomaly, scanCount } =
    await repo.getParentHomeData(parentId);

  if (!parent) return null;

  const TOKEN_PRIORITY = {
    ACTIVE: 0,
    ISSUED: 1,
    INACTIVE: 2,
    EXPIRED: 3,
    REVOKED: 4,
    UNASSIGNED: 5,
  };

  const pickBestToken = tokens => {
    if (!tokens?.length) return null;
    return tokens
      .slice()
      .sort((a, b) => (TOKEN_PRIORITY[a.status] ?? 9) - (TOKEN_PRIORITY[b.status] ?? 9))[0];
  };

  const students = studentLinks.map(({ student, relationship, is_primary }) => {
    const token = pickBestToken(student.tokens);
    const card = token?.cards[0] ?? null;
    const qr = token?.qrAsset ?? null;

    return {
      id: student.id,
      first_name: student.first_name,
      last_name: student.last_name,
      class: student.class,
      section: student.section,
      photo_url: student.photo_url,
      setup_stage: student.setup_stage,
      gender: student.gender ?? null,
      dob: student.dob_encrypted ? safeDecrypt(student.dob_encrypted) : null,
      relationship,
      is_primary,
      school: student.school ?? null,
      token: token
        ? {
            id: token.id,
            status: token.status,
            expires_at: token.expires_at,
            card_number: card?.card_number ?? null,
            qr_url: qr?.public_url ?? null,
            is_qr_active: qr?.is_active ?? false,
          }
        : null,
      emergency: student.emergency ? shapeEmergency(student.emergency) : null,
      card_visibility: student.cardVisibility ?? null,
      location_consent: student.locationConsent ?? null,
      last_scan: student.lastScan ?? null,
      scan_count: student.scanCount ?? 0,
      anomaly: student.anomaly ?? null,
    };
  });

  students.sort((a, b) => {
    if (a.is_primary && !b.is_primary) return -1;
    if (!a.is_primary && b.is_primary) return 1;
    return (a.first_name ?? '').localeCompare(b.first_name ?? '');
  });

  const activeStudentId =
    parent.active_student_id ?? students.find(s => s.is_primary)?.id ?? students[0]?.id ?? null;

  return {
    parent: {
      id: parent.id,
      name: parent.name,
      email: parent.email ?? null,
      avatar_url: parent.avatar_url ?? null,
      phone: parent.phone ? maskPhone(safeDecrypt(parent.phone)) : null,
      is_phone_verified: parent.is_phone_verified,
      is_email_verified: parent.is_email_verified ?? false,
      active_student_id: activeStudentId,
      notification_prefs: parent.notificationPrefs || {},
    },
    students,
    last_scan: lastScan ?? null,
    scan_count: scanCount,
    anomaly: anomaly ?? null,
    cache_ttl_days: 30,
  };
}

function shapeEmergency(ep) {
  return {
    blood_group: ep.blood_group,
    allergies: ep.allergies,
    conditions: ep.conditions,
    medications: ep.medications,
    doctor_name: ep.doctor_name,
    doctor_phone: safeDecrypt(ep.doctor_phone_encrypted),
    notes: ep.notes,
    visibility: ep.visibility,
    is_visible: ep.is_visible,
    contacts: ep.contacts.map(c => ({
      id: c.id,
      name: c.name,
      phone: safeDecrypt(c.phone_encrypted),
      relationship: c.relationship,
      priority: c.priority,
      display_order: c.display_order,
      call_enabled: c.call_enabled,
      whatsapp_enabled: c.whatsapp_enabled,
    })),
  };
}

// ─── GET /me/scans ────────────────────────────────────────────────────────────

export async function getScanHistory(parentId, query) {
  const { student_id, cursor, limit, filter } = query;
  return repo.getScanHistory({ parentId, studentId: student_id, cursor, limit, filter });
}

// ─── PATCH /me/profile ───────────────────────────────────────────────────────

export async function updateProfile(parentId, body) {
  const { student_id, student, emergency, contacts } = body;

  const encryptedContacts = contacts?.map(c => {
    if (!c.phone) throw new ApiError('Contact phone is required', 400, 'INVALID_CONTACT');
    return {
      ...c,
      phone: encryptField(c.phone),
    };
  });

  const sensitiveFields = [
    'blood_group',
    'doctor_name',
    'doctor_phone',
    'allergies',
    'conditions',
    'medications',
  ];
  const hasSensitiveChange =
    emergency && Object.keys(emergency).some(k => sensitiveFields.includes(k));

  const encryptedEmergency = emergency
    ? {
        ...emergency,
        doctor_phone: emergency.doctor_phone ? encryptField(emergency.doctor_phone) : undefined,
      }
    : undefined;

  await repo.updateStudentProfile({
    parentId,
    studentId: student_id,
    student,
    emergency: encryptedEmergency,
    contacts: encryptedContacts,
  });

  const token = await prisma.token.findFirst({
    where: { student_id: student_id, status: 'ACTIVE' },
    select: { id: true },
  });
  if (token) await invalidateScanCache(token.id);

  writeAuditLog({
    actorId: parentId,
    actorType: 'PARENT_USER',
    action: 'PROFILE_UPDATE',
    entity: 'Student',
    entityId: student_id,
  });

  await invalidateParentHome(parentId);
  return { cache_invalidated: true };
}

// ─── PATCH /me/visibility ────────────────────────────────────────────────────

export async function updateVisibility(parentId, body) {
  const { student_id, visibility, hidden_fields } = body;

  await repo.updateCardVisibility({ parentId, student_id, visibility, hidden_fields });

  writeAuditLog({
    actorId: parentId,
    actorType: 'PARENT_USER',
    action: 'CARD_VISIBILITY_UPDATE',
    entity: 'CardVisibility',
    entityId: student_id,
  });

  // Bust scan cache so change reflects immediately on next QR scan
  const token = await prisma.token.findFirst({
    where: { student_id, status: 'ACTIVE' },
    select: { id: true },
  });
  if (token) await invalidateScanCache(token.id);

  await invalidateParentHome(parentId);
  return { cache_invalidated: true };
}

// ─── PATCH /me/notifications ─────────────────────────────────────────────────

export async function updateNotifications(parentId, prefs) {
  await repo.updateNotificationPrefs(parentId, prefs);
  await invalidateParentHome(parentId);
  return { cache_invalidated: true };
}

// ─── PATCH /me/location-consent ──────────────────────────────────────────────

export async function updateLocationConsent(parentId, body) {
  await repo.updateLocationConsent({
    parentId,
    studentId: body.student_id,
    enabled: body.enabled,
  });
  await invalidateParentHome(parentId);
  return { cache_invalidated: true };
}

// ─── POST /me/lock-card ──────────────────────────────────────────────────────

export async function lockCard(parentId, body) {
  const { student_id } = body;

  const studentName = await getStudentName(student_id);
  const parentInfo = await getParentContactInfo(parentId);

  const result = await repo.lockStudentCard({ parentId, studentId: student_id });

  writeAuditLog({
    actorId: parentId,
    actorType: 'PARENT_USER',
    action: 'CARD_BLOCK',
    entity: 'Token',
    entityId: student_id,
  });

  publishNotification
    .parentCardLocked({
      actorId: parentId,
      schoolId: null,
      payload: {
        parentName: parentInfo?.name ?? 'Parent',
        studentName,
        parentEmail: parentInfo?.email ?? null,
        parentPhone: parentInfo?.phone ? safeDecrypt(parentInfo.phone) : null,
        parentExpoTokens: [],
      },
      meta: { studentId: student_id },
    })
    .catch(err => logger.warn({ err: err.message }, '[parent] Card lock notification failed'));

  await invalidateParentHome(parentId);
  return { ...result, cache_invalidated: true };
}

// ─── POST /me/request-replace ────────────────────────────────────────────────

export async function requestCardReplacement(parentId, body) {
  const { student_id, reason } = body;

  const studentName = await getStudentName(student_id);
  const parentInfo = await getParentContactInfo(parentId);

  const result = await repo.createReplaceRequest({ parentId, ...body });

  writeAuditLog({
    actorId: parentId,
    actorType: 'PARENT_USER',
    action: 'CARD_REPLACEMENT_REQUEST',
    entity: 'ParentEditLog',
    entityId: result.id,
  });

  publishNotification
    .parentCardReplaceRequested({
      actorId: parentId,
      schoolId: null,
      payload: {
        parentName: parentInfo?.name ?? 'Parent',
        studentName,
        reason,
        parentEmail: parentInfo?.email ?? null,
        parentPhone: parentInfo?.phone ? safeDecrypt(parentInfo.phone) : null,
      },
      meta: { studentId: student_id },
    })
    .catch(err => logger.warn({ err: err.message }, '[parent] Card replace notification failed'));

  return result;
}

// ─── DELETE /me ──────────────────────────────────────────────────────────────

export async function deleteAccount(parentId) {
  const parentInfo = await getParentContactInfo(parentId);

  await repo.softDeleteParent(parentId);
  await invalidateParentHome(parentId);

  writeAuditLog({
    actorId: parentId,
    actorType: 'PARENT_USER',
    action: 'ACCOUNT_DELETE',
    entity: 'ParentUser',
    entityId: parentId,
  });

  publishNotification
    .parentAccountDeleted({
      actorId: parentId,
      payload: {
        parentName: parentInfo?.name ?? 'Parent',
        parentEmail: parentInfo?.email ?? null,
        parentPhone: parentInfo?.phone ? safeDecrypt(parentInfo.phone) : null,
      },
    })
    .catch(err => logger.warn({ err: err.message }, '[parent] Account delete notification failed'));
}

// ─── GET /me/location-history ────────────────────────────────────────────────

export async function getLocationHistory(parentId, query) {
  const { student_id, cursor, limit = 20, from_date, to_date } = query;

  if (!student_id) throw new Error('student_id is required');

  return repo.getLocationHistory({
    parentId,
    studentId: student_id,
    cursor,
    limit,
    fromDate: from_date ? new Date(from_date) : undefined,
    toDate: to_date ? new Date(to_date) : undefined,
  });
}

// ─── GET /me/anomalies ───────────────────────────────────────────────────────

export async function getAnomalies(parentId, query) {
  const { cursor, limit = 20, severity, resolved } = query;

  return repo.getAnomalies(parentId, {
    cursor,
    limit,
    severity,
    resolved: resolved === 'true' ? true : resolved === 'false' ? false : undefined,
  });
}

// ─── GET /me/cards ───────────────────────────────────────────────────────────

export async function getCards(parentId) {
  const cards = await repo.getCards(parentId);

  return cards.map(card => ({
    id: card.id,
    card_number: card.card_number,
    student_name: `${card.student.first_name || ''} ${card.student.last_name || ''}`.trim(),
    student_id: card.student.id,
    status: card.token?.status || 'UNASSIGNED',
    expires_at: card.token?.expires_at,
    file_url: card.file_url,
    print_status: card.print_status,
  }));
}

// ─── POST /me/request-renewal ────────────────────────────────────────────────

export async function requestRenewal(parentId, body) {
  const { card_id, payment_method } = body;

  const cardDetails = await getCardDetails(card_id);
  const studentName = cardDetails?.student
    ? `${cardDetails.student.first_name || ''} ${cardDetails.student.last_name || ''}`.trim()
    : 'Student';
  const parentInfo = await getParentContactInfo(parentId);

  const result = await repo.requestRenewal(parentId, {
    cardId: card_id,
    paymentMethod: payment_method,
  });

  writeAuditLog({
    actorId: parentId,
    actorType: 'PARENT_USER',
    action: 'CARD_RENEWAL_REQUEST',
    entity: 'Card',
    entityId: card_id,
  });

  publishNotification
    .parentCardRenewalRequested({
      actorId: parentId,
      schoolId: cardDetails?.student?.school?.id ?? null,
      payload: {
        studentName,
        schoolName: cardDetails?.student?.school?.name ?? 'School',
        parentPhone: parentInfo?.phone ? safeDecrypt(parentInfo.phone) : null,
        parentEmail: parentInfo?.email ?? null,
        adminEmail: null,
      },
      meta: { studentId: cardDetails?.student?.id },
    })
    .catch(err => logger.warn({ err: err.message }, '[parent] Renewal notification failed'));

  return result;
}

// ─── POST /me/change-phone ───────────────────────────────────────────────────

export async function changePhone(parentId, newPhone, otp, ipAddress) {
  const oldParentInfo = await prisma.parentUser.findUnique({
    where: { id: parentId },
    select: { phone: true, email: true, name: true },
  });

  const decryptedOldPhone = oldParentInfo?.phone ? safeDecrypt(oldParentInfo.phone) : null;
  const parentEmail = oldParentInfo?.email;
  const parentName = oldParentInfo?.name;

  const storedData = await redis.get(`otp:phone_change:${newPhone}`);
  if (!storedData) throw new Error('OTP expired or not requested');

  const otpData = JSON.parse(storedData);
  const inputHash = hashOtp(otp);
  const storedBuf = Buffer.from(otpData.hash, 'hex');
  const inputBuf = Buffer.from(inputHash, 'hex');
  const valid = storedBuf.length === inputBuf.length && crypto.timingSafeEqual(storedBuf, inputBuf);
  if (!valid) throw new Error('Invalid OTP');

  const phoneIndex = hashForLookup(newPhone);
  const encryptedPhone = encryptField(newPhone);

  await prisma.parentUser.update({
    where: { id: parentId },
    data: { phone: encryptedPhone, phone_index: phoneIndex, is_phone_verified: true },
  });

  await prisma.session.updateMany({
    where: { parent_user_id: parentId, is_active: true },
    data: { is_active: false, revoked_at: new Date(), revoke_reason: 'PHONE_CHANGED' },
  });

  await redis.del(`otp:phone_change:${newPhone}`);

  writeAuditLog({
    actorId: parentId,
    actorType: 'PARENT_USER',
    action: 'PHONE_CHANGED',
    entity: 'ParentUser',
    entityId: parentId,
    ip: ipAddress,
  });

  publishNotification
    .parentPhoneChanged({
      actorId: parentId,
      payload: {
        parentName,
        oldPhone: decryptedOldPhone,
        newPhone,
        parentEmail: parentEmail ?? null,
      },
    })
    .catch(err => logger.warn({ err: err.message }, '[parent] Phone change notification failed'));

  await invalidateParentHome(parentId);
  return { message: 'Phone number updated. Please login again.' };
}

// ─── POST /device-token ───────────────────────────────────────────────────────

export async function registerDeviceToken(parentId, body) {
  return repo.upsertDeviceToken(parentId, body);
}

// ─── GET /me/children ─────────────────────────────────────────────────────────

export async function getChildrenList(parentId) {
  const students = await prisma.parentStudent.findMany({
    where: { parent_id: parentId },
    select: {
      student: {
        select: {
          id: true,
          first_name: true,
          last_name: true,
          class: true,
          section: true,
          photo_url: true,
          tokens: {
            select: { status: true, expires_at: true },
            take: 1,
            orderBy: { created_at: 'desc' },
          },
        },
      },
      is_primary: true,
      relationship: true,
    },
    orderBy: { created_at: 'asc' },
  });

  return students.map(item => ({
    id: item.student.id,
    first_name: item.student.first_name,
    last_name: item.student.last_name,
    class: item.student.class,
    section: item.student.section,
    photo_url: item.student.photo_url,
    is_primary: item.is_primary,
    relationship: item.relationship,
    token_status: item.student.tokens?.[0]?.status || null,
    token_expiry: item.student.tokens?.[0]?.expires_at || null,
  }));
}

// ─── POST /me/link-card ───────────────────────────────────────────────────────

export async function linkCard({ parentId, cardNumber, ipAddress }) {
  const card = await repo.findCardByNumber(cardNumber);
  if (!card) throw new ApiError('Card not found', 404);

  if (card.student?.parents?.length > 0) {
    const existingParentId = card.student.parents[0].parent_id;
    if (existingParentId !== parentId) {
      throw new ApiError('This card is already linked to another parent', 409);
    }
  }

  let studentId = card.student_id;

  if (!studentId) {
    const newStudent = await repo.createStubStudent(card.school_id, card.student?.first_name);
    studentId = newStudent.id;
    await repo.createEmergencyProfileForStudent(studentId);
    await repo.updateCardStudentId(card.id, studentId);
  }

  const existingLink = await repo.findParentStudentLink(parentId, studentId);
  if (existingLink) throw new ApiError('This child is already linked to your account', 409);

  const existingChildrenCount = await repo.countParentChildren(parentId);
  const MAX_FREE_CHILDREN = 3;
  if (existingChildrenCount >= MAX_FREE_CHILDREN) {
    throw new ApiError(
      `Free plan supports up to ${MAX_FREE_CHILDREN} children. Upgrade to add more.`,
      403
    );
  }

  await repo.createParentStudentLink(parentId, studentId, existingChildrenCount === 0);

  const cardWithToken = await repo.findCardTokenId(card.id);
  if (cardWithToken?.token_id) {
    await repo.activateTokenForStudent(cardWithToken.token_id, studentId);
  }

  await prisma.student.update({
    where: { id: studentId },
    data: { setup_stage: 'COMPLETE' },
  });

  if (existingChildrenCount === 0) {
    await repo.setParentActiveStudent(parentId, studentId);
  }

  await invalidateParentHome(parentId);

  const parent = await repo.findParentEmail(parentId);

  publishNotification
    .parentCardLinked({
      actorId: parentId,
      schoolId: card.school_id,
      payload: {
        parentName: parent?.name ?? 'Parent',
        studentName: card.student?.first_name || 'Child',
        cardNumber,
        parentExpoTokens: [],
      },
      meta: { studentId },
    })
    .catch(err => logger.warn({ err: err.message }, '[parent] Link card notification failed'));

  return {
    success: true,
    student_id: studentId,
    student_name: card.student?.first_name || 'Child',
    is_first_child: existingChildrenCount === 0,
  };
}

// ─── PATCH /me/active-student ─────────────────────────────────────────────────

export async function setActiveStudent(parentId, studentId) {
  const link = await prisma.parentStudent.findFirst({
    where: { parent_id: parentId, student_id: studentId },
  });

  if (!link) throw new ApiError('Student not linked to this parent', 403);

  await prisma.parentUser.update({
    where: { id: parentId },
    data: { active_student_id: studentId },
  });

  await invalidateParentHome(parentId);

  writeAuditLog({
    actorId: parentId,
    actorType: 'PARENT_USER',
    action: 'ACTIVE_STUDENT_CHANGED',
    entity: 'ParentUser',
    entityId: parentId,
    metadata: { student_id: studentId },
  });

  return { success: true, active_student_id: studentId };
}

export { invalidateParentHome };

// ─── POST /me/unlink-child/init ──────────────────────────────────────────────

export async function unlinkChildInit({ parentId, studentId, ipAddress }) {
  const link = await repo.findParentStudentLink(parentId, studentId);
  if (!link) throw new ApiError('Student not linked to this account', 404);

  const parent = await repo.findParentPhone(parentId);
  if (!parent?.phone) throw new ApiError('Parent phone not found', 400);

  const decryptedPhone = safeDecrypt(parent.phone);
  if (!decryptedPhone) throw new ApiError('Unable to verify phone', 400);

  const rateKey = `unlink:rate:${parentId}`;
  const attempts = await redis.incr(rateKey);
  if (attempts === 1) await redis.expire(rateKey, 3600);
  if (attempts > 3) throw new ApiError('Too many attempts. Try after 1 hour.', 429);

  const otp = generateOtp();
  const nonce = crypto.randomBytes(32).toString('hex');
  const hashedOtp = hashOtp(otp);

  if (process.env.NODE_ENV === 'development') {
    console.log('[DEV Unlink OTP]', otp);
  }

  const otpData = { hash: hashedOtp, parentId, studentId, attempts: 0 };

  await Promise.all([
    redis.setex(`otp:unlink:${nonce}`, 300, JSON.stringify(otpData)),
    redis.setex(`otp:attempts:unlink:${parentId}`, 300, '0'),
  ]);

  const sms = getSms();
  await sms.send(
    decryptedPhone,
    `RESQID: Use OTP ${otp} to remove child from your account. Valid for 5 minutes.`
  );

  writeAuditLog({
    actorId: parentId,
    actorType: 'PARENT_USER',
    action: 'UNLINK_CHILD_INIT',
    entity: 'Student',
    entityId: studentId,
    ip: ipAddress,
  });

  return { nonce, expiresIn: 300, masked_phone: maskPhone(decryptedPhone) };
}

// ─── POST /me/unlink-child/verify ────────────────────────────────────────────

export async function unlinkChildVerify({ parentId, studentId, otp, nonce, ipAddress }) {
  const storedData = await redis.get(`otp:unlink:${nonce}`);
  if (!storedData) throw new ApiError('Session expired. Please start again.', 400);

  const otpData = JSON.parse(storedData);
  const inputHash = hashOtp(otp);
  const storedBuf = Buffer.from(otpData.hash, 'hex');
  const inputBuf = Buffer.from(inputHash, 'hex');
  const isValid =
    storedBuf.length === inputBuf.length && crypto.timingSafeEqual(storedBuf, inputBuf);

  if (!isValid) {
    const attemptsKey = `otp:attempts:unlink:${parentId}`;
    const attempts = await redis.incr(attemptsKey);
    if (attempts >= 5) {
      await redis.del(`otp:unlink:${nonce}`);
      throw new ApiError('Too many invalid attempts. Please start again.', 400);
    }
    throw new ApiError('Invalid OTP', 400);
  }

  const link = await repo.findParentStudentLink(parentId, studentId);
  if (!link) throw new ApiError('Student not linked to this account', 404);

  const student = await repo.findStudentById(studentId);
  const studentName = student
    ? `${student.first_name || ''} ${student.last_name || ''}`.trim()
    : 'Child';

  await repo.deleteParentStudentLink(parentId, studentId);
  await repo.deactivateTokenForStudent(studentId);

  const remainingCount = await repo.getRemainingChildrenCount(parentId);
  let newActiveStudentId = null;

  if (remainingCount === 0) {
    await prisma.parentUser.update({
      where: { id: parentId },
      data: { active_student_id: null },
    });
  } else {
    const remainingChildren = await prisma.parentStudent.findMany({
      where: { parent_id: parentId },
      take: 1,
      select: { student_id: true },
    });
    newActiveStudentId = remainingChildren[0]?.student_id || null;
    if (newActiveStudentId) {
      await repo.updateParentActiveStudent(parentId, newActiveStudentId);
    }
  }

  await redis.del(`otp:unlink:${nonce}`);
  await redis.del(`otp:attempts:unlink:${parentId}`);

  const parent = await repo.findParentPhone(parentId);

  publishNotification
    .parentChildUnlinked({
      actorId: parentId,
      schoolId: null,
      payload: {
        parentName: parent?.name ?? 'Parent',
        studentName,
        parentExpoTokens: [],
        parentPhone: parent?.phone ? safeDecrypt(parent.phone) : null,
      },
      meta: { studentId },
    })
    .catch(err => logger.warn({ err: err.message }, '[parent] Unlink notification failed'));

  writeAuditLog({
    actorId: parentId,
    actorType: 'PARENT_USER',
    action: 'UNLINK_CHILD_VERIFY',
    entity: 'Student',
    entityId: studentId,
    ip: ipAddress,
    metadata: { studentName, remainingChildren: remainingCount },
  });

  await invalidateParentHome(parentId);

  return {
    success: true,
    message: `${studentName} has been removed from your account`,
    remaining_children: remainingCount,
    active_student_id: newActiveStudentId,
  };
}

// ─── Parent avatar ────────────────────────────────────────────────────────────

export async function updateParentAvatar(parentId, avatarUrl) {
  await prisma.parentUser.update({
    where: { id: parentId },
    data: { avatar_url: avatarUrl },
  });

  await invalidateParentHome(parentId);

  writeAuditLog({
    actorId: parentId,
    actorType: 'PARENT_USER',
    action: 'AVATAR_UPDATED',
    entity: 'ParentUser',
    entityId: parentId,
  });

  return { avatar_url: avatarUrl };
}

// =============================================================================
// STUDENT PHOTO UPLOAD
// =============================================================================

export async function confirmStudentPhotoUpload(parentId, studentId, key, nonce) {
  const nonceKey = `upload:nonce:${nonce}`;
  const nonceData = await redis.get(nonceKey);

  if (!nonceData) {
    throw new ApiError('Upload session expired', 400);
  }

  const { parentId: storedParentId, studentId: storedStudentId } = JSON.parse(nonceData);

  if (storedParentId !== parentId || storedStudentId !== studentId) {
    throw new ApiError('Invalid upload confirmation', 403);
  }

  const cdnDomain = process.env.AWS_CDN_DOMAIN || 'assets.getresqid.in';
  const photoUrl = `https://${cdnDomain}/${key}`;

  await prisma.student.update({
    where: { id: studentId },
    data: { photo_url: photoUrl },
  });

  await redis.del(nonceKey);
  await invalidateParentHome(parentId);

  return { success: true, photo_url: photoUrl };
}

// =============================================================================
// STUDENT BASIC INFO
// =============================================================================

export async function updateStudentBasicInfo(parentId, studentId, data) {
  const link = await repo.findParentStudentLink(parentId, studentId);
  if (!link) throw new ApiError('Student not linked to this parent', 403);

  const updateData = {};

  if (data.first_name !== undefined) updateData.first_name = data.first_name?.trim();
  if (data.last_name !== undefined) updateData.last_name = data.last_name?.trim();
  if (data.class !== undefined) updateData.class = data.class?.trim();
  if (data.section !== undefined) updateData.section = data.section?.trim();
  if (data.gender !== undefined) updateData.gender = data.gender;

  if (data.dob !== undefined) {
    updateData.dob_encrypted = encryptField(data.dob);
  }

  await prisma.student.update({
    where: { id: studentId },
    data: updateData,
  });

  await invalidateParentHome(parentId);

  return { success: true };
}

// =============================================================================
// PARENT AVATAR UPLOAD CONFIRM
// =============================================================================

export async function confirmParentAvatarUpload(parentId, key, nonce) {
  const nonceKey = `upload:nonce:${nonce}`;
  const nonceData = await redis.get(nonceKey);

  if (!nonceData) {
    throw new ApiError('Upload session expired', 400);
  }

  const { parentId: storedParentId } = JSON.parse(nonceData);

  if (storedParentId !== parentId) {
    throw new ApiError('Invalid upload confirmation', 403);
  }

  const cdnDomain = process.env.AWS_CDN_DOMAIN || 'assets.getresqid.in';
  const avatarUrl = `https://${cdnDomain}/${key}`;

  await prisma.parentUser.update({
    where: { id: parentId },
    data: { avatar_url: avatarUrl },
  });

  await redis.del(nonceKey);
  await invalidateParentHome(parentId);

  return { success: true, avatar_url: avatarUrl };
}

// =============================================================================
// PARENT PROFILE
// =============================================================================

export async function updateParentName(parentId, name) {
  await prisma.parentUser.update({
    where: { id: parentId },
    data: { name: name?.trim() },
  });

  await invalidateParentHome(parentId);

  return { success: true, name };
}

// =============================================================================
// EMAIL VERIFICATION
// =============================================================================

export async function sendEmailVerificationOtp(parentId, email) {
  const rateKey = `otp:email_verify:rate:${parentId}`;
  const count = await redis.incr(rateKey);
  if (count === 1) await redis.expire(rateKey, 3600);
  if (count > 3)
    throw new ApiError('Too many OTP requests. Try after 1 hour.', 429, 'RATE_LIMITED');

  const existing = await prisma.parentUser.findFirst({
    where: { email, NOT: { id: parentId } },
  });
  if (existing) throw new ApiError('Email already in use by another account', 409, 'EMAIL_TAKEN');

  const otp = generateOtp();
  console.log('[DEV EMAIL OTP VERIFICATION CODE]:', otp);
  const hashed = hashOtp(otp);

  await redis.setex(
    `otp:email_verify:${parentId}`,
    300,
    JSON.stringify({ hash: hashed, email, attempts: 0 })
  );

  const emailService = getEmail();
  await emailService.sendReactTemplate(
    OtpParentEmail,
    { userName: 'Parent', otpCode: otp, expiryMinutes: 5 },
    { to: email, subject: 'Your RESQID Email Verification Code' }
  );

  logger.info({ parentId }, '[parent] Email verification OTP sent');
  return { success: true, message: 'OTP sent to your email', expiresIn: 300 };
}

export async function verifyEmail(parentId, email, otp) {
  const stored = await redis.get(`otp:email_verify:${parentId}`);
  if (!stored) throw new ApiError('OTP expired or not requested', 400, 'OTP_EXPIRED');

  const data = JSON.parse(stored);

  if (data.email !== email)
    throw new ApiError('Email does not match OTP request', 400, 'EMAIL_MISMATCH');

  if (data.attempts >= 3) {
    await redis.del(`otp:email_verify:${parentId}`);
    throw new ApiError('Too many failed attempts. Request a new OTP.', 429, 'MAX_ATTEMPTS');
  }

  const inputHash = hashOtp(otp);
  const valid = crypto.timingSafeEqual(
    Buffer.from(inputHash, 'hex'),
    Buffer.from(data.hash, 'hex')
  );

  if (!valid) {
    data.attempts += 1;
    await redis.setex(`otp:email_verify:${parentId}`, 300, JSON.stringify(data));
    throw new ApiError(`Invalid OTP. ${3 - data.attempts} attempt(s) left.`, 400, 'INVALID_OTP');
  }

  await prisma.parentUser.update({
    where: { id: parentId },
    data: { email, is_email_verified: true },
  });

  await redis.del(`otp:email_verify:${parentId}`);
  await invalidateParentHome(parentId);

  sendParentWelcome(parentId).catch(err =>
    logger.warn({ err: err.message }, '[parent] Welcome email trigger failed')
  );

  logger.info({ parentId }, '[parent] Email verified');
  return { success: true, message: 'Email verified successfully' };
}

// =============================================================================
// EMAIL CHANGE
// =============================================================================

export async function sendEmailChangeOtp(parentId, newEmail) {
  const rateKey = `otp:email_change:rate:${parentId}`;
  const count = await redis.incr(rateKey);
  if (count === 1) await redis.expire(rateKey, 3600);
  if (count > 3)
    throw new ApiError('Too many OTP requests. Try after 1 hour.', 429, 'RATE_LIMITED');

  const existing = await prisma.parentUser.findFirst({
    where: { email: newEmail, NOT: { id: parentId } },
  });
  if (existing) throw new ApiError('Email already in use by another account', 409, 'EMAIL_TAKEN');

  const parent = await prisma.parentUser.findUnique({
    where: { id: parentId },
    select: { name: true, email: true },
  });

  const otp = generateOtp();
  console.log('[DEV EMAIL CHANGE OTP]:', otp);
  const hashed = hashOtp(otp);

  await redis.setex(
    `otp:email_change:${parentId}`,
    300,
    JSON.stringify({ hash: hashed, email: newEmail, attempts: 0 })
  );

  const emailService = getEmail();
  await emailService.sendReactTemplate(
    OtpParentEmail,
    { userName: parent?.name || 'Parent', otpCode: otp, expiryMinutes: 5 },
    { to: newEmail, subject: 'Verify Your New Email - RESQID' }
  );

  logger.info({ parentId, newEmail }, '[parent] Email change OTP sent');
  return { success: true, message: 'OTP sent to your new email', expiresIn: 300 };
}

export async function verifyEmailChange(parentId, newEmail, otp) {
  const stored = await redis.get(`otp:email_change:${parentId}`);
  if (!stored) throw new ApiError('OTP expired or not requested', 400, 'OTP_EXPIRED');

  const data = JSON.parse(stored);

  if (data.email !== newEmail)
    throw new ApiError('Email does not match OTP request', 400, 'EMAIL_MISMATCH');

  if (data.attempts >= 3) {
    await redis.del(`otp:email_change:${parentId}`);
    throw new ApiError('Too many failed attempts. Request a new OTP.', 429, 'MAX_ATTEMPTS');
  }

  const inputHash = hashOtp(otp);
  const valid = crypto.timingSafeEqual(
    Buffer.from(inputHash, 'hex'),
    Buffer.from(data.hash, 'hex')
  );

  if (!valid) {
    data.attempts += 1;
    await redis.setex(`otp:email_change:${parentId}`, 300, JSON.stringify(data));
    throw new ApiError(`Invalid OTP. ${3 - data.attempts} attempt(s) left.`, 400, 'INVALID_OTP');
  }

  const parent = await prisma.parentUser.findUnique({
    where: { id: parentId },
    select: { email: true, name: true },
  });

  const oldEmail = parent?.email;

  await prisma.parentUser.update({
    where: { id: parentId },
    data: { email: newEmail, is_email_verified: true },
  });

  await redis.del(`otp:email_change:${parentId}`);
  await invalidateParentHome(parentId);

  if (oldEmail && oldEmail !== newEmail) {
    try {
      const result = await publishNotification.parentEmailChanged({
        actorId: parentId,
        payload: { parentName: parent.name ?? 'Parent', oldEmail, newEmail },
      });
      logger.info({ result, oldEmail, newEmail }, '[parent] Email changed notification enqueued');
    } catch (err) {
      logger.error({ err: err.message }, '[parent] Email changed notification FAILED to enqueue');
    }
  }

  logger.info({ parentId, oldEmail, newEmail }, '[parent] Email changed');
  return { success: true, message: 'Email updated successfully' };
}
