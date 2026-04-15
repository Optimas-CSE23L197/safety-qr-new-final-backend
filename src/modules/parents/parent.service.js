// =============================================================================
// modules/parents/parent.service.js — RESQID (FIXED IMPORTS)
// =============================================================================

import crypto from 'crypto';
import * as repo from './parent.repository.js';
import { encryptField, decryptField, hashForLookup } from '#shared/security/encryption.js';
import { prisma } from '#config/prisma.js';
import { redis } from '#config/redis.js';
import { logger } from '#config/logger.js';

// ─── CORRECT IMPORTS (matching your project structure) ────────────────────────
import { cacheGet, cacheSet, cacheDel } from '#shared/cache/cache.js';
import { generateOtp, hashOtp } from '#services/otp.service.js';
import { getSms } from '#infrastructure/sms/sms.index.js';
import { getEmail } from '#infrastructure/email/email.index.js';

// ─── ApiError class ───────────────────────────────────────────────────────────
class ApiError extends Error {
  constructor(message, statusCode = 400, code = 'ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

// ─── Audit logger stub (replace with real import if exists) ───────────────────
const writeAuditLog = data => {
  logger.info({ ...data }, 'AUDIT');
};

// ─── Cache helpers using your actual cache functions ──────────────────────────
const HOME_KEY = id => `parent:home:${id}`;
const HOME_TTL = 5 * 60; // 5 minutes

async function cacheAside(key, ttl, fetchFn) {
  const cached = await cacheGet(key);
  if (cached !== null) return cached;

  const data = await fetchFn();
  if (data !== null && data !== undefined) {
    await cacheSet(key, data, ttl);
  }
  return data;
}

async function invalidateParentHome(parentId) {
  await cacheDel(HOME_KEY(parentId));
}

// ─── Notification helpers ─────────────────────────────────────────────────────
async function sendSms(phone, message) {
  try {
    const sms = getSms();
    return await sms.send(phone, message);
  } catch (err) {
    logger.error({ err: err.message, phone }, '[parent.service] SMS failed');
  }
}

async function sendEmail({ to, subject, html }) {
  try {
    const email = getEmail();
    return await email.send({ to, subject, html });
  } catch (err) {
    logger.error({ err: err.message, to }, '[parent.service] Email failed');
  }
}

// ─── Helper to get parent contact info ───────────────────────────────────────
async function getParentContactInfo(parentId) {
  const parent = await prisma.parentUser.findUnique({
    where: { id: parentId },
    select: { email: true, phone: true, name: true },
  });
  return parent;
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
  const card = await prisma.card.findUnique({
    where: { id: cardId },
    select: {
      card_number: true,
      student: { select: { first_name: true, last_name: true } },
    },
  });
  return card;
}

function maskPhone(phone) {
  if (!phone) return 'Unknown';
  const last4 = phone.slice(-4);
  const prefix = phone.slice(0, 3);
  return `${prefix}****${last4}`;
}

// ─── Safe decrypt ─────────────────────────────────────────────────────────────
function safeDecrypt(encrypted) {
  if (!encrypted) return null;
  try {
    return decryptField(encrypted);
  } catch {
    return null;
  }
}

// ─── GET /me ─────────────────────────────────────────────────────────────────
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
    };
  });

  students.sort((a, b) => {
    if (a.is_primary && !b.is_primary) return -1;
    if (!a.is_primary && b.is_primary) return 1;
    return (a.first_name ?? '').localeCompare(b.first_name ?? '');
  });

  return {
    parent: {
      id: parent.id,
      name: parent.name,
      is_phone_verified: parent.is_phone_verified,
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
  const { cursor, limit, filter } = query;
  return repo.getScanHistory({ parentId, cursor, limit, filter });
}

// ─── PATCH /me/profile ───────────────────────────────────────────────────────
export async function updateProfile(parentId, body) {
  const { student_id, student, emergency, contacts } = body;

  console.log('[updateProfile] Received student payload:', student);

  const studentName = await getStudentName(student_id);
  const parentInfo = await getParentContactInfo(parentId);

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

  const encryptedContacts = contacts?.map(c => ({
    ...c,
    phone: encryptField(c.phone),
  }));

  await repo.updateStudentProfile({
    parentId,
    studentId: student_id,
    student,
    emergency: encryptedEmergency,
    contacts: encryptedContacts,
  });

  writeAuditLog({
    actorId: parentId,
    actorType: 'PARENT_USER',
    action: 'PROFILE_UPDATE',
    entity: 'Student',
    entityId: student_id,
  });

  if (hasSensitiveChange && parentInfo?.email) {
    sendEmail({
      to: parentInfo.email,
      subject: '📝 Emergency Profile Updated - RESQID',
      html: `<div>Emergency profile for ${studentName} updated at ${new Date().toLocaleString()}</div>`,
    }).catch(err => logger.warn({ err: err.message }, 'Profile update email failed'));
  }

  await invalidateParentHome(parentId);
  return { cache_invalidated: true };
}

// ─── PATCH /me/visibility ────────────────────────────────────────────────────
export async function updateVisibility(parentId, body) {
  const { student_id, visibility, hidden_fields } = body;

  await repo.updateCardVisibility({
    parentId,
    student_id,
    visibility,
    hidden_fields,
  });

  writeAuditLog({
    actorId: parentId,
    actorType: 'PARENT_USER',
    action: 'CARD_VISIBILITY_UPDATE',
    entity: 'CardVisibility',
    entityId: student_id,
  });

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
  // 🟢 FIX: Map student_id to studentId for repository
  await repo.updateLocationConsent({
    parentId,
    studentId: body.student_id, // ← Map the field name
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

  const result = await repo.lockStudentCard({
    parentId,
    studentId: student_id,
  });

  writeAuditLog({
    actorId: parentId,
    actorType: 'PARENT_USER',
    action: 'CARD_BLOCK',
    entity: 'Token',
    entityId: student_id,
  });

  if (parentInfo?.email) {
    sendEmail({
      to: parentInfo.email,
      subject: '🔒 Card Locked - RESQID Security Alert',
      html: `<div>Card for ${studentName} locked at ${new Date().toLocaleString()}</div>`,
    }).catch(err => logger.warn({ err: err.message }, 'Card lock email failed'));
  }

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

  if (parentInfo?.phone) {
    sendSms(
      parentInfo.phone,
      `RESQID: Card replacement for ${studentName} requested. ID: ${result.id.slice(0, 8)}`
    ).catch(err => logger.warn({ err: err.message }, 'Card replacement SMS failed'));
  }

  if (parentInfo?.email) {
    sendEmail({
      to: parentInfo.email,
      subject: '🆔 Card Replacement Request Received - RESQID',
      html: `<div>Request ID: ${result.id}<br>Student: ${studentName}<br>Reason: ${reason}</div>`,
    }).catch(err => logger.warn({ err: err.message }, 'Card replacement email failed'));
  }

  return result;
}

// ─── DELETE /me ──────────────────────────────────────────────────────────────
export async function deleteAccount(parentId) {
  const parentInfo = await getParentContactInfo(parentId);

  if (parentInfo?.email) {
    sendEmail({
      to: parentInfo.email,
      subject: '👋 RESQID Account Deleted',
      html: `<div>Your RESQID account has been deleted at ${new Date().toLocaleString()}</div>`,
    }).catch(err => logger.warn({ err: err.message }, 'Account deletion email failed'));
  }

  await repo.softDeleteParent(parentId);
  await invalidateParentHome(parentId);

  writeAuditLog({
    actorId: parentId,
    actorType: 'PARENT_USER',
    action: 'ACCOUNT_DELETE',
    entity: 'ParentUser',
    entityId: parentId,
  });
}

// ─── GET /me/location-history ────────────────────────────────────────────────
export async function getLocationHistory(parentId, query) {
  const { student_id, cursor, limit = 20, from_date, to_date } = query;

  if (!student_id) {
    throw new Error('student_id is required');
  }

  const fromDate = from_date ? new Date(from_date) : undefined;
  const toDate = to_date ? new Date(to_date) : undefined;

  const result = await repo.getLocationHistory({
    parentId,
    studentId: student_id,
    cursor,
    limit,
    fromDate,
    toDate,
  });

  return result;
}

// ─── GET /me/anomalies ───────────────────────────────────────────────────────
export async function getAnomalies(parentId, query) {
  const { cursor, limit = 20, severity, resolved } = query;

  const result = await repo.getAnomalies(parentId, {
    cursor,
    limit,
    severity,
    resolved: resolved === 'true' ? true : resolved === 'false' ? false : undefined,
  });

  return result;
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

  if (parentInfo?.email) {
    sendEmail({
      to: parentInfo.email,
      subject: '🔄 Card Renewal Request Received - RESQID',
      html: `<div>Card: ${cardDetails?.card_number || 'N/A'}<br>Student: ${studentName}<br>Payment: ${payment_method}</div>`,
    }).catch(err => logger.warn({ err: err.message }, 'Card renewal email failed'));
  }

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
    data: {
      phone: encryptedPhone,
      phone_index: phoneIndex,
      is_phone_verified: true,
    },
  });

  await prisma.session.updateMany({
    where: { parent_user_id: parentId, is_active: true },
    data: {
      is_active: false,
      revoked_at: new Date(),
      revoke_reason: 'PHONE_CHANGED',
    },
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

  sendSms(
    newPhone,
    `RESQID: Your account phone number has been changed. If not you, contact support.`
  ).catch(err => logger.warn({ err: err.message }, 'Phone change SMS to new number failed'));

  if (decryptedOldPhone && decryptedOldPhone !== newPhone) {
    sendSms(
      decryptedOldPhone,
      `RESQID ALERT: Your account phone was changed to ${newPhone} at ${new Date().toLocaleString()}.`
    ).catch(err => logger.warn({ err: err.message }, 'Phone change SMS to old number failed'));
  }

  if (parentEmail) {
    sendEmail({
      to: parentEmail,
      subject: '📱 Phone Number Changed - RESQID Security Alert',
      html: `<div>Hello ${parentName || 'Parent'},<br>Phone changed from ${maskPhone(decryptedOldPhone || 'Unknown')} to ${maskPhone(newPhone)}<br>IP: ${ipAddress || 'Unknown'}<br>Time: ${new Date().toLocaleString()}</div>`,
    }).catch(err => logger.warn({ err: err.message }, 'Phone change email failed'));
  }

  await invalidateParentHome(parentId);
  return { message: 'Phone number updated. Please login again.' };
}

// ─── POST /device-token ───────────────────────────────────────────────────────
export async function registerDeviceToken(parentId, body) {
  const device = await repo.upsertDeviceToken(parentId, body);
  return device;
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

  if (existingChildrenCount === 0) {
    await repo.setParentActiveStudent(parentId, studentId);
  }

  await invalidateParentHome(parentId);

  const parent = await repo.findParentEmail(parentId);
  if (parent?.email) {
    sendEmail({
      to: parent.email,
      subject: '👶 New Child Added - RESQID',
      html: `<div>Your child has been added to your RESQID account.</div>`,
    }).catch(err => logger.warn({ err: err.message }, 'Link card email failed'));
  }

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

// ─── Exports ─────────────────────────────────────────────────────────────────
export { invalidateParentHome };

// ─── POST /me/unlink-child/init ──────────────────────────────────────────────
export async function unlinkChildInit({ parentId, studentId, ipAddress }) {
  console.log('[unlinkChildInit Service] Start');

  // Verify student is linked to this parent
  const link = await repo.findParentStudentLink(parentId, studentId);
  console.log('[unlinkChildInit Service] Link found:', link);

  if (!link) {
    throw new ApiError('Student not linked to this account', 404);
  }

  // Get parent's phone
  const parent = await repo.findParentPhone(parentId);
  console.log('[unlinkChildInit Service] Parent:', parent);

  if (!parent?.phone) {
    throw new ApiError('Parent phone not found', 400);
  }

  const decryptedPhone = safeDecrypt(parent.phone);
  console.log('[unlinkChildInit Service] Decrypted phone:', decryptedPhone);

  if (!decryptedPhone) {
    throw new ApiError('Unable to verify phone', 400);
  }

  // Rate limit
  const rateKey = `unlink:rate:${parentId}`;
  const attempts = await redis.incr(rateKey);
  if (attempts === 1) await redis.expire(rateKey, 3600);
  if (attempts > 3) {
    throw new ApiError('Too many attempts. Try after 1 hour.', 429);
  }

  // Generate OTP and nonce
  const otp = generateOtp();
  const nonce = crypto.randomBytes(32).toString('hex');
  const hashedOtp = hashOtp(otp);

  if (process.env.NODE_ENV === 'development') {
    console.log('[DEV Unlink OTP]', otp);
  }

  const otpData = {
    hash: hashedOtp,
    parentId,
    studentId,
    attempts: 0,
  };

  await Promise.all([
    redis.setex(`otp:unlink:${nonce}`, 300, JSON.stringify(otpData)),
    redis.setex(`otp:attempts:unlink:${parentId}`, 300, '0'),
  ]);

  // Send OTP via SMS
  await sendSms(
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

  return {
    nonce,
    expiresIn: 300,
    masked_phone: maskPhone(decryptedPhone),
  };
}

// unlinkChildVerify function

export async function unlinkChildVerify({ parentId, studentId, otp, nonce, ipAddress }) {
  // Get OTP data
  const storedData = await redis.get(`otp:unlink:${nonce}`);
  if (!storedData) {
    throw new ApiError('Session expired. Please start again.', 400);
  }

  const otpData = JSON.parse(storedData);

  // Verify OTP
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

  // Verify student is still linked
  const link = await repo.findParentStudentLink(parentId, studentId);
  if (!link) {
    throw new ApiError('Student not linked to this account', 404);
  }

  // Get student name for notification
  const student = await repo.findStudentById(studentId);
  const studentName = student
    ? `${student.first_name || ''} ${student.last_name || ''}`.trim()
    : 'Child';

  // Remove the link
  await repo.deleteParentStudentLink(parentId, studentId);

  // Deactivate token
  await repo.deactivateTokenForStudent(studentId);

  // Check remaining children and update active student
  const remainingCount = await repo.getRemainingChildrenCount(parentId);
  let newActiveStudentId = null;

  if (remainingCount === 0) {
    // Clear active student when no children left
    await prisma.parentUser.update({
      where: { id: parentId },
      data: { active_student_id: null },
    });
  } else {
    // Set to first remaining child
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

  // Clean up Redis
  await redis.del(`otp:unlink:${nonce}`);
  await redis.del(`otp:attempts:unlink:${parentId}`);

  // Send email notification
  const parent = await repo.findParentPhone(parentId);
  if (parent?.email) {
    await sendEmail({
      to: parent.email,
      subject: '👋 Child Removed from RESQID',
      html: `<div>${studentName} has been removed from your RESQID account.<br>Time: ${new Date().toLocaleString()}<br>IP: ${ipAddress || 'Unknown'}</div>`,
    }).catch(() => {});
  }

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

// Add after existing exports

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
