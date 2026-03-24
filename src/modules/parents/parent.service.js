// =============================================================================
// modules/parents/parent.service.js — RESQID
// Orchestration + encryption + caching. No Prisma.
//
// CACHE STRATEGY
// ─────────────────────────────────────────────────────────────────────────────
// Server Redis (5min):  serves API calls during the short refresh window
// Device cache (30days): the real cache — app serves from SecureStore/MMKV
//                        invalidated by: profile edit, scan push notification
//
// Any write operation that changes data the home screen shows must:
//   1. Invalidate server Redis → next /me call hits DB fresh
//   2. Return { cache_invalidated: true } in response
//   3. App sees this flag → clears device cache → re-fetches /me
// =============================================================================

// =============================================================================
// modules/parents/parent.service.js — RESQID (FIXED)
// Orchestration + encryption + caching. No Prisma.
// =============================================================================

import crypto from "crypto";
import * as repo from "./parent.repository.js";
import { cacheAside, cacheDel } from "../../utils/cache/cache.js";
import {
  encryptField,
  decryptField,
  hashForLookup,
} from "../../utils/security/encryption.js";
import { writeAuditLog, AuditAction } from "../../utils/helpers/auditLogger.js";
import { buildOffsetMeta } from "../../utils/response/paginate.js";
import { prisma } from "../../config/prisma.js";
import { redis } from "../../config/redis.js";
import { hashOtp } from "../../services/otp/otp.service.js";
import { logger } from "../../config/logger.js";

const HOME_KEY = (id) => `parent:home:${id}`;
const HOME_TTL = 5 * 60; // 5 min server-side Redis TTL

// ... rest of your service functions (keep them as is) ...

// ─── GET /me ─────────────────────────────────────────────────────────────────

export async function getParentHomeData(parentId) {
  return cacheAside(HOME_KEY(parentId), HOME_TTL, () =>
    fetchAndShape(parentId),
  );
}

export async function invalidateParentHome(parentId) {
  await cacheDel(HOME_KEY(parentId));
}

async function fetchAndShape(parentId) {
  const { parent, studentLinks, lastScan, anomaly, scanCount } =
    await repo.getParentHomeData(parentId);

  if (!parent) return null;

  // Token status priority: ACTIVE is best, then ISSUED, INACTIVE, EXPIRED, REVOKED
  // This ensures replacement cards (ACTIVE) win over old revoked cards
  const TOKEN_PRIORITY = {
    ACTIVE: 0,
    ISSUED: 1,
    INACTIVE: 2,
    EXPIRED: 3,
    REVOKED: 4,
    UNASSIGNED: 5,
  };
  const pickBestToken = (tokens) => {
    if (!tokens?.length) return null;
    return tokens
      .slice()
      .sort(
        (a, b) =>
          (TOKEN_PRIORITY[a.status] ?? 9) - (TOKEN_PRIORITY[b.status] ?? 9),
      )[0];
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
    return (a.first_name ?? "").localeCompare(b.first_name ?? "");
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
    // Device should cache this response for 30 days
    // Invalidated by: any write endpoint returning cache_invalidated: true
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
    contacts: ep.contacts.map((c) => ({
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

  // Encrypt sensitive fields before DB write
  const encryptedEmergency = emergency
    ? {
        ...emergency,
        doctor_phone: emergency.doctor_phone
          ? encryptField(emergency.doctor_phone)
          : undefined,
      }
    : undefined;

  // Encrypt contact phones
  const encryptedContacts = contacts?.map((c) => ({
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
    actorType: "PARENT_USER",
    action: "PROFILE_UPDATE",
    entity: "Student",
    entityId: student_id,
  });

  // Invalidate server cache → device will re-fetch and update its 30-day cache
  await invalidateParentHome(parentId);
  return { cache_invalidated: true };
}

// ─── PATCH /me/visibility ────────────────────────────────────────────────────

export async function updateVisibility(parentId, body) {
  await repo.updateCardVisibility({ parentId, ...body });

  writeAuditLog({
    actorId: parentId,
    actorType: "PARENT_USER",
    action: "CARD_VISIBILITY_UPDATE",
    entity: "CardVisibility",
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
  const result = await repo.lockStudentCard({
    parentId,
    studentId: body.student_id,
  });

  writeAuditLog({
    actorId: parentId,
    actorType: "PARENT_USER",
    action: "CARD_BLOCK",
    entity: "Token",
    entityId: body.student_id,
  });

  await invalidateParentHome(parentId);
  return { ...result, cache_invalidated: true };
}

// ─── POST /me/request-replace ────────────────────────────────────────────────

export async function requestCardReplacement(parentId, body) {
  const result = await repo.createReplaceRequest({ parentId, ...body });

  writeAuditLog({
    actorId: parentId,
    actorType: "PARENT_USER",
    action: "CARD_REPLACEMENT_REQUEST",
    entity: "ParentEditLog",
    entityId: result.id,
  });

  return result;
}

// ─── DELETE /me ──────────────────────────────────────────────────────────────

export async function deleteAccount(parentId) {
  await repo.softDeleteParent(parentId);
  await invalidateParentHome(parentId);

  writeAuditLog({
    actorId: parentId,
    actorType: "PARENT_USER",
    action: "ACCOUNT_DELETE",
    entity: "ParentUser",
    entityId: parentId,
  });
}

// ─── GET /me/location-history ────────────────────────────────────────────────
// NEW: Get location history for a student

export async function getLocationHistory(parentId, query) {
  const { student_id, cursor, limit = 20, from_date, to_date } = query;

  if (!student_id) {
    throw new Error("student_id is required");
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
// NEW: Get anomalies for parent's students

export async function getAnomalies(parentId, query) {
  const { cursor, limit = 20, severity, resolved } = query;

  const result = await repo.getAnomalies(parentId, {
    cursor,
    limit,
    severity,
    resolved:
      resolved === "true" ? true : resolved === "false" ? false : undefined,
  });

  return result;
}

// ─── GET /me/cards ───────────────────────────────────────────────────────────
// NEW: Get all cards for parent's students

export async function getCards(parentId) {
  const cards = await repo.getCards(parentId);

  return cards.map((card) => ({
    id: card.id,
    card_number: card.card_number,
    student_name:
      `${card.student.first_name || ""} ${card.student.last_name || ""}`.trim(),
    student_id: card.student.id,
    status: card.token?.status || "UNASSIGNED",
    expires_at: card.token?.expires_at,
    file_url: card.file_url,
    print_status: card.print_status,
  }));
}

// ─── POST /me/request-renewal ────────────────────────────────────────────────
// NEW: Request card renewal

export async function requestRenewal(parentId, body) {
  const { card_id, payment_method } = body;

  const result = await repo.requestRenewal(parentId, {
    cardId: card_id,
    paymentMethod: payment_method,
  });

  writeAuditLog({
    actorId: parentId,
    actorType: "PARENT_USER",
    action: "CARD_RENEWAL_REQUEST",
    entity: "Card",
    entityId: card_id,
  });

  return result;
}

// ─── PATCH /me/notification-prefs ────────────────────────────────────────────
// EXISTING - already implemented

// ─── PATCH /me/change-phone ──────────────────────────────────────────────────
// NEW: Change parent phone number (with OTP verification)

export async function changePhone(parentId, newPhone, otp, ipAddress) {
  // Verify OTP
  const storedData = await redis.get(`otp:phone_change:${newPhone}`);
  if (!storedData) throw new Error("OTP expired or not requested");

  const otpData = JSON.parse(storedData);
  const inputHash = hashOtp(otp);
  const storedBuf = Buffer.from(otpData.hash, "hex");
  const inputBuf = Buffer.from(inputHash, "hex");

  const valid =
    storedBuf.length === inputBuf.length &&
    crypto.timingSafeEqual(storedBuf, inputBuf);

  if (!valid) throw new Error("Invalid OTP");

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
  await repo.revokeAllUserSessions(parentId, "PARENT_USER", "PHONE_CHANGED");

  // Clean up OTP
  await redis.del(`otp:phone_change:${newPhone}`);

  writeAuditLog({
    actorId: parentId,
    actorType: "PARENT_USER",
    action: "PHONE_CHANGED",
    entity: "ParentUser",
    entityId: parentId,
    ip: ipAddress,
  });

  return { message: "Phone number updated. Please login again." };
}
