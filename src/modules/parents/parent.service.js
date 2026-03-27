// =============================================================================
// modules/parents/parent.service.js — RESQID (COMPLETE WITH NOTIFICATIONS)
// Orchestration + encryption + caching + NOTIFICATIONS. No Prisma.
//
// NOTIFICATIONS TRIGGERS:
//   - Phone change: SMS + Email
//   - Card lock: Email
//   - Card replacement: SMS + Email
//   - Card renewal: Email
//   - Profile update (sensitive fields): Email
//   - Account deletion: Email
// =============================================================================

import crypto from 'crypto';
import * as repo from './parent.repository.js';
import { cacheAside, cacheDel } from '#utils/cache/cache.js';
import { encryptField, decryptField, hashForLookup } from '#utils/security/encryption.js';
import { writeAuditLog } from '#utils/helpers/auditLogger.js';
import { prisma } from '#config/database/prisma.js';
import { redis } from '#config/database/redis.js';
import { hashOtp } from '#services/otp/otp.service.js';
import { logger } from '#config/logger.js';
import { ENV } from '#config/env.js';

// Import notification services
import { sendSms } from '#integrations/sms/sms.service.js';
import { sendEmail } from '#integrations/email/email.service.js';

const HOME_KEY = id => `parent:home:${id}`;
const HOME_TTL = 5 * 60; // 5 min server-side Redis TTL

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

// ─── GET /me ─────────────────────────────────────────────────────────────────

export async function getParentHomeData(parentId) {
  return cacheAside(HOME_KEY(parentId), HOME_TTL, () => fetchAndShape(parentId));
}

export async function invalidateParentHome(parentId) {
  await cacheDel(HOME_KEY(parentId));
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

function safeDecrypt(encrypted) {
  if (!encrypted) return null;
  try {
    return decryptField(encrypted);
  } catch {
    return null;
  }
}

// ─── GET /me/scans ────────────────────────────────────────────────────────────

export async function getScanHistory(parentId, query) {
  const { cursor, limit, filter } = query;
  return repo.getScanHistory({ parentId, cursor, limit, filter });
}

// ─── PATCH /me/profile ───────────────────────────────────────────────────────

export async function updateProfile(parentId, body) {
  const { student_id, student, emergency, contacts } = body;

  // Get student name for notification
  const studentName = await getStudentName(student_id);
  const parentInfo = await getParentContactInfo(parentId);

  // Check if sensitive fields were updated
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

  // Encrypt sensitive fields before DB write
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

  // ✅ NOTIFICATION: Send email for sensitive changes
  if (hasSensitiveChange && parentInfo?.email) {
    sendEmail({
      to: parentInfo.email,
      subject: '📝 Emergency Profile Updated - RESQID',
      html: `
        <!DOCTYPE html>
        <html>
        <head><style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #E8342A; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { padding: 20px; background: #f9f9f9; border: 1px solid #ddd; border-top: none; border-radius: 0 0 8px 8px; }
          .alert-box { background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; }
          .info-row { margin: 10px 0; padding: 8px; background: white; border-radius: 4px; }
          .footer { text-align: center; margin-top: 20px; font-size: 12px; color: #666; }
        </style>
        </head>
        <body>
          <div class="container">
            <div class="header"><h1>📝 Emergency Profile Updated</h1></div>
            <div class='content'>
              <p>Hello <strong>${parentInfo.name || 'Parent'}</strong>,</p>
              <p>The emergency profile for <strong>${studentName}</strong> has been updated.</p>
              <div class="alert-box">
                <strong>⚠️ If you didn"t make this change</strong><br>
                Please contact support immediately.
              </div>
              <div class="info-row">⏰ Time: ${new Date().toLocaleString()}</div>
              <p style="margin-top: 20px; font-size: 14px; color: #666;">
                This is an automated notification from RESQID.
              </p>
            </div>
            <div class='footer'>
              <p>&copy; ${new Date().getFullYear()} RESQID. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `,
    }).catch(err => logger.warn({ err: err.message }, 'Profile update email failed'));
  }

  await invalidateParentHome(parentId);
  return { cache_invalidated: true };
}

// ─── PATCH /me/visibility ────────────────────────────────────────────────────

export async function updateVisibility(parentId, body) {
  await repo.updateCardVisibility({ parentId, ...body });

  writeAuditLog({
    actorId: parentId,
    actorType: 'PARENT_USER',
    action: 'CARD_VISIBILITY_UPDATE',
    entity: 'CardVisibility',
    entityId: body.student_id,
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
  await repo.updateLocationConsent({ parentId, ...body });
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

  // ✅ NOTIFICATION: Send email alert
  if (parentInfo?.email) {
    sendEmail({
      to: parentInfo.email,
      subject: '🔒 Card Locked - RESQID Security Alert',
      html: `
        <!DOCTYPE html>
        <html>
        <head><style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #E8342A; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { padding: 20px; background: #f9f9f9; border: 1px solid #ddd; border-top: none; border-radius: 0 0 8px 8px; }
          .alert-box { background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; }
          .info-row { margin: 10px 0; padding: 8px; background: white; border-radius: 4px; }
          .footer { text-align: center; margin-top: 20px; font-size: 12px; color: #666; }
        </style>
        </head>
        <body>
          <div class="container">
            <div class="header"><h1>🔒 Card Locked</h1></div>
            <div class='content'>
              <p>Hello <strong>${parentInfo.name || 'Parent'}</strong>,</p>
              <p>The RESQID card for <strong>${studentName}</strong> has been locked successfully.</p>
              <div class="alert-box">
                <strong>✅ If you locked this card</strong><br>
                No further action is needed.
              </div>
              <div class="info-row">⏰ Time: ${new Date().toLocaleString()}</div>
              <p style="margin-top: 20px; font-size: 14px; color: #dc3545;">
                ⚠️ If you didn"t lock this card, please contact support immediately.
              </p>
            </div>
            <div class='footer'>
              <p>&copy; ${new Date().getFullYear()} RESQID. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `,
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

  // ✅ NOTIFICATION: Send SMS confirmation
  if (parentInfo?.phone) {
    sendSms(
      parentInfo.phone,
      `RESQID: Your card replacement request for ${studentName} has been received. Request ID: ${result.id.slice(0, 8)}. We'll notify you when it's processed.`
    ).catch(err => logger.warn({ err: err.message }, 'Card replacement SMS failed'));
  }

  // ✅ NOTIFICATION: Send email confirmation
  if (parentInfo?.email) {
    sendEmail({
      to: parentInfo.email,
      subject: '🆔 Card Replacement Request Received - RESQID',
      html: `
        <!DOCTYPE html>
        <html>
        <head><style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #28a745; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { padding: 20px; background: #f9f9f9; border: 1px solid #ddd; border-top: none; border-radius: 0 0 8px 8px; }
          .info-row { margin: 10px 0; padding: 8px; background: white; border-radius: 4px; }
          .footer { text-align: center; margin-top: 20px; font-size: 12px; color: #666; }
        </style>
        </head>
        <body>
          <div class="container">
            <div class="header"><h1>🆔 Card Replacement Request Received</h1></div>
            <div class='content'>
              <p>Hello <strong>${parentInfo.name || 'Parent'}</strong>,</p>
              <p>Your request to replace the RESQID card for <strong>${studentName}</strong> has been received.</p>
              <div class="info-row"><strong>Reason:</strong> ${reason}</div>
              <div class="info-row"><strong>Request ID:</strong> ${result.id}</div>
              <div class="info-row"><strong>Time:</strong> ${new Date().toLocaleString()}</div>
              <p style="margin-top: 20px; background: #d4edda; padding: 15px; border-radius: 5px; color: #155724;">
                ✅ We will process your request within 3-5 business days. You"ll receive another notification when your new card is ready.
              </p>
            </div>
            <div class='footer'>
              <p>&copy; ${new Date().getFullYear()} RESQID. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `,
    }).catch(err => logger.warn({ err: err.message }, 'Card replacement email failed'));
  }

  return result;
}

// ─── DELETE /me ──────────────────────────────────────────────────────────────

export async function deleteAccount(parentId) {
  const parentInfo = await getParentContactInfo(parentId);

  // ✅ NOTIFICATION: Send goodbye email before deletion
  if (parentInfo?.email) {
    sendEmail({
      to: parentInfo.email,
      subject: '👋 RESQID Account Deleted',
      html: `
        <!DOCTYPE html>
        <html>
        <head><style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #6c757d; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { padding: 20px; background: #f9f9f9; border: 1px solid #ddd; border-top: none; border-radius: 0 0 8px 8px; }
          .alert-box { background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; }
          .footer { text-align: center; margin-top: 20px; font-size: 12px; color: #666; }
        </style>
        </head>
        <body>
          <div class="container">
            <div class="header"><h1>👋 Account Deleted</h1></div>
            <div class='content'>
              <p>Hello <strong>${parentInfo.name || 'Parent'}</strong>,</p>
              <p>Your RESQID account has been successfully deleted.</p>
              <div class="alert-box">
                <strong>⚠️ If you didn"t request this deletion</strong><br>
                Please contact support immediately.
              </div>
              <div class="info-row">⏰ Time: ${new Date().toLocaleString()}</div>
              <p style="margin-top: 20px; font-size: 14px; color: #666;">
                We"re sorry to see you go. If you change your mind, you can always create a new account.
              </p>
              <p style="margin-top: 20px; font-size: 14px;">
                Thank you for being part of the RESQID community.
              </p>
            </div>
            <div class='footer'>
              <p>&copy; ${new Date().getFullYear()} RESQID. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `,
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

  // ✅ NOTIFICATION: Send email confirmation
  if (parentInfo?.email) {
    sendEmail({
      to: parentInfo.email,
      subject: '🔄 Card Renewal Request Received - RESQID',
      html: `
        <!DOCTYPE html>
        <html>
        <head><style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #28a745; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { padding: 20px; background: #f9f9f9; border: 1px solid #ddd; border-top: none; border-radius: 0 0 8px 8px; }
          .info-row { margin: 10px 0; padding: 8px; background: white; border-radius: 4px; }
          .footer { text-align: center; margin-top: 20px; font-size: 12px; color: #666; }
        </style>
        </head>
        <body>
          <div class="container">
            <div class="header"><h1>🔄 Card Renewal Request Received</h1></div>
            <div class='content'>
              <p>Hello <strong>${parentInfo.name || 'Parent'}</strong>,</p>
              <p>Your request to renew the RESQID card for <strong>${studentName}</strong> has been received.</p>
              <div class='info-row'><strong>Card Number:</strong> ${cardDetails?.card_number || 'N/A'}</div>
              <div class="info-row"><strong>Payment Method:</strong> ${payment_method}</div>
              <div class="info-row"><strong>Request ID:</strong> ${result.requestId}</div>
              <div class="info-row"><strong>Time:</strong> ${new Date().toLocaleString()}</div>
              <p style="margin-top: 20px; background: #d4edda; padding: 15px; border-radius: 5px; color: #155724;">
                ✅ We will process your renewal shortly. You"ll receive another notification when your card is renewed.
              </p>
            </div>
            <div class='footer'>
              <p>&copy; ${new Date().getFullYear()} RESQID. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `,
    }).catch(err => logger.warn({ err: err.message }, 'Card renewal email failed'));
  }

  return result;
}

// ─── POST /me/change-phone ───────────────────────────────────────────────────

export async function changePhone(parentId, newPhone, otp, ipAddress) {
  // Get old phone and parent info before update
  const oldParentInfo = await prisma.parentUser.findUnique({
    where: { id: parentId },
    select: { phone: true, email: true, name: true },
  });

  const oldPhone = oldParentInfo?.phone || 'Unknown';
  const parentEmail = oldParentInfo?.email;
  const parentName = oldParentInfo?.name;

  // Verify OTP
  const storedData = await redis.get(`otp:phone_change:${newPhone}`);
  if (!storedData) throw new Error('OTP expired or not requested');

  const otpData = JSON.parse(storedData);
  const inputHash = hashOtp(otp);
  const storedBuf = Buffer.from(otpData.hash, 'hex');
  const inputBuf = Buffer.from(inputHash, 'hex');

  const valid = storedBuf.length === inputBuf.length && crypto.timingSafeEqual(storedBuf, inputBuf);

  if (!valid) throw new Error('Invalid OTP');

  // Update phone
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

  // Revoke all sessions
  await prisma.session.updateMany({
    where: { parent_user_id: parentId, is_active: true },
    data: {
      is_active: false,
      revoked_at: new Date(),
      revoke_reason: 'PHONE_CHANGED',
    },
  });

  // Clean up OTP
  await redis.del(`otp:phone_change:${newPhone}`);

  writeAuditLog({
    actorId: parentId,
    actorType: 'PARENT_USER',
    action: 'PHONE_CHANGED',
    entity: 'ParentUser',
    entityId: parentId,
    ip: ipAddress,
  });

  // ✅ NOTIFICATION: Send SMS to new phone
  sendSms(
    newPhone,
    `RESQID: Your account phone number has been changed successfully. If you didn't make this change, please contact support immediately.`
  ).catch(err => logger.warn({ err: err.message }, 'Phone change SMS to new number failed'));

  // ✅ NOTIFICATION: Send SMS to old phone (security alert)
  if (oldPhone && oldPhone !== newPhone) {
    sendSms(
      oldPhone,
      `RESQID ALERT: Your account phone number was changed to ${newPhone} on ${new Date().toLocaleString()}. If this wasn't you, please contact support immediately.`
    ).catch(err => logger.warn({ err: err.message }, 'Phone change SMS to old number failed'));
  }

  // ✅ NOTIFICATION: Send email to parent
  if (parentEmail) {
    sendEmail({
      to: parentEmail,
      subject: '📱 Phone Number Changed - RESQID Security Alert',
      html: `
        <!DOCTYPE html>
        <html>
        <head><style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #E8342A; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { padding: 20px; background: #f9f9f9; border: 1px solid #ddd; border-top: none; border-radius: 0 0 8px 8px; }
          .alert-box { background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; }
          .info-row { margin: 10px 0; padding: 8px; background: white; border-radius: 4px; }
          .footer { text-align: center; margin-top: 20px; font-size: 12px; color: #666; }
        </style>
        </head>
        <body>
          <div class="container">
            <div class="header"><h1>📱 Phone Number Changed</h1></div>
            <div class='content'>
              <p>Hello <strong>${parentName || 'Parent'}</strong>,</p>
              <p>Your RESQID account phone number has been changed.</p>
              <div class="info-row"><strong>📞 Old Phone:</strong> ${maskPhone(oldPhone)}</div>
              <div class="info-row"><strong>📱 New Phone:</strong> ${maskPhone(newPhone)}</div>
              <div class='info-row'><strong>🌍 IP Address:</strong> ${ipAddress || 'Unknown'}</div>
              <div class="info-row"><strong>⏰ Time:</strong> ${new Date().toLocaleString()}</div>
              <div class="alert-box">
                <strong>⚠️ If you didn"t make this change</strong><br>
                Please contact support immediately to secure your account.
              </div>
              <p style="margin-top: 20px; font-size: 14px; color: #28a745;">
                ✅ If you made this change, no further action is needed.
              </p>
            </div>
            <div class='footer'>
              <p>This is an automated security alert from RESQID.</p>
              <p>&copy; ${new Date().getFullYear()} RESQID. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `,
    }).catch(err => logger.warn({ err: err.message }, 'Phone change email failed'));
  }

  await invalidateParentHome(parentId);
  return { message: 'Phone number updated. Please login again.' };
}

function maskPhone(phone) {
  if (!phone) return 'Unknown';
  const last4 = phone.slice(-4);
  const prefix = phone.slice(0, 3);
  return `${prefix}****${last4}`;
}
