// =============================================================================
// transformer.js — RESQID
// DTO-style output shaping — strip sensitive fields before sending to client
// NEVER send raw Prisma objects to the client
//
// Rules:
//   - Encrypted fields are NEVER sent (phone_encrypted, dob_encrypted, etc.)
//   - password_hash is NEVER sent
//   - Internal IDs are sent only where needed
//   - Phone numbers are masked in list views (show last 4 only)
//   - Emergency contacts: phone decrypted + formatted for tap-to-call
// =============================================================================

import { decryptField } from "../Security/encryption.js";

// ─── Parent User ──────────────────────────────────────────────────────────────

/**
 * transformParent — safe profile for parent's own view
 */

export function transformParent(parent) {
  if (!parent) return null;
  return {
    id: parent.id,
    name: parent.name,
    email: parent.email,
    phone: maskPhone(parent.phone),
    avatarUrl: parent.avatar_url,
    preferredLanguage: parent.preferred_language,
    preferredTheme: parent.preferred_theme,
    isPhoneVerified: parent.is_phone_verified,
    isEmailVerified: parent.is_email_verified,
    status: parent.status,
    createdAt: parent.created_at,
    // NEVER include: password_hash, phone_index, deleted_at (internal)
  };
}

/**
 * transformParentAdmin — for school admin / super admin viewing parent
 */
export function transformParentAdmin(parent) {
  if (!parent) return null;
  return {
    id: parent.id,
    name: parent.name,
    email: parent.email,
    phone: maskPhone(parent.phone),
    status: parent.status,
    isPhoneVerified: parent.is_phone_verified,
    lastLoginAt: parent.last_login_at,
    createdAt: parent.created_at,
  };
}

/**
 * transformStudent — for parent app (own child)
 */
export function transformStudent(student) {
  if (!student) return null;
  return {
    id: student.id,
    profileType: student.profile_type,
    setupStage: student.setup_stage,
    firstName: student.first_name,
    lastName: student.last_name,
    fullName: buildFullName(student.first_name, student.last_name),
    photoUrl: student.photo_url,
    gender: student.gender,
    class: student.class,
    section: student.section,
    rollNumber: student.roll_number,
    admissionNumber: student.admission_number,
    isActive: student.is_active,
    schoolId: student.school_id,
    // NEVER include: dob_encrypted (decrypt only when explicitly needed)
  };
}

/**
 * transformStudentAdmin — for school admin dashboard
 */
export function transformStudentAdmin(student) {
  if (!student) return null;
  return {
    id: student.id,
    fullName: buildFullName(student.first_name, student.last_name),
    photoUrl: student.photo_url,
    class: student.class,
    section: student.section,
    rollNumber: student.roll_number,
    admissionNumber: student.admission_number,
    setupStage: student.setup_stage,
    isActive: student.is_active,
    hasToken: !!student.tokens?.length,
    hasEmergencyProfile: !!student.emergency,
    parents: student.parents?.map(transformParentAdmin) ?? [],
  };
}

// ─── Emergency Profile (Public Emergency Page) ────────────────────────────────

/**
 * transformEmergencyPublic
 * Output for public QR scan page — decrypts contacts for tap-to-call
 * This is the most security-sensitive transformer — only show what's needed
 */
export async function transformEmergencyPublic(
  student,
  profile,
  contacts,
  visibility,
) {
  if (!profile || !profile.is_visible) return null;

  // Respect card visibility settings
  const hidden = new Set(visibility?.hidden_fields ?? []);

  const safeContacts = await Promise.all(
    (contacts ?? [])
      .filter((c) => c.is_active)
      .sort((a, b) => a.display_order - b.display_order)
      .map(async (c) => ({
        name: c.name,
        relationship: c.relationship,
        phone: await decryptField(c.phone_encrypted), // decrypt for call
        callEnabled: c.call_enabled,
        whatsappEnabled: c.whatsapp_enabled,
        priority: c.priority,
      })),
  );

  return {
    // Student info — only what scanner needs
    ...(!hidden.has("student_name") && {
      studentName: buildFullName(student.first_name, student.last_name),
    }),
    ...(!hidden.has("photo") && {
      photoUrl: student.photo_url,
    }),
    ...(!hidden.has("class") &&
      student.class && {
        class: student.class,
        section: student.section,
      }),

    // Medical — critical for emergency responders
    ...(!hidden.has("blood_group") && {
      bloodGroup: profile.blood_group,
    }),
    ...(!hidden.has("allergies") && {
      allergies: profile.allergies,
    }),
    ...(!hidden.has("conditions") && {
      conditions: profile.conditions,
    }),
    ...(!hidden.has("medications") && {
      medications: profile.medications,
    }),

    // Emergency contacts — always shown if profile is visible
    emergencyContacts: safeContacts,

    // Notes — optional
    ...(!hidden.has("notes") &&
      profile.notes && {
        notes: profile.notes,
      }),
  };
}

// ─── Token / QR ───────────────────────────────────────────────────────────────

export function transformToken(token) {
  if (!token) return null;
  return {
    id: token.id,
    status: token.status,
    qrUrl: token.qrAsset?.public_url ?? null,
    cardNumber: token.cards?.[0]?.card_number ?? null,
    activatedAt: token.activated_at,
    expiresAt: token.expires_at,
    assignedAt: token.assigned_at,
    // NEVER include: token_hash (raw hash — internal only)
  };
}

// ─── School ───────────────────────────────────────────────────────────────────

export function transformSchool(school) {
  if (!school) return null;
  return {
    id: school.id,
    name: school.name,
    code: school.code,
    city: school.city,
    country: school.country,
    logoUrl: school.logo_url,
    timezone: school.timezone,
    isActive: school.is_active,
  };
}

// ─── Scan Log ─────────────────────────────────────────────────────────────────

export function transformScanLog(scan) {
  if (!scan) return null;
  return {
    id: scan.id,
    result: scan.result,
    city: scan.ip_city,
    country: scan.ip_country,
    createdAt: scan.created_at,
    // NEVER include: ip_address, device_hash (privacy)
  };
}

// ─── Notification ─────────────────────────────────────────────────────────────

export function transformNotification(n) {
  if (!n) return null;
  return {
    id: n.id,
    type: n.type,
    status: n.status,
    payload: n.payload,
    sentAt: n.sent_at,
    createdAt: n.created_at,
  };
}

export function transformDevice(device) {
  if (!device) return null;
  return {
    id: device.id,
    platform: device.platform,
    deviceName: device.device_name,
    isActive: device.is_active,
    lastSeenAt: device.last_seen_at,
    createdAt: device.created_at,
    // NEVER include: device_token (FCM token — internal only)
  };
}

// ─── Card Order ───────────────────────────────────────────────────────────────

export function transformOrder(order) {
  if (!order) return null;
  return {
    id: order.id,
    orderNumber: order.order_number,
    orderType: order.order_type,
    channel: order.channel,
    cardCount: order.card_count,
    totalAmount: order.total_amount,
    status: order.status,
    paymentStatus: order.payment_status,
    shipment: order.shipment ? transformShipment(order.shipment) : null,
    createdAt: order.created_at,
  };
}

export function transformShipment(shipment) {
  if (!shipment) return null;
  return {
    trackingNumber: shipment.tracking_number,
    trackingUrl: shipment.tracking_url,
    courier: shipment.courier_name,
    status: shipment.status,
    shippedAt: shipment.shipped_at,
    estimatedAt: shipment.estimated_at,
    deliveredAt: shipment.delivered_at,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function buildFullName(first, last) {
  return [first, last].filter(Boolean).join(" ") || null;
}

/**
 * maskPhone — show last 4 digits only in list views
 * Full phone only shown when decrypted for emergency contact
 * +91 98765 43210 → +91 ******* 3210
 */
export function maskPhone(phone) {
  if (!phone) return null;
  if (phone.length < 4) return "****";
  const last4 = phone.slice(-4);
  const prefix = phone.length > 8 ? phone.slice(0, phone.length - 8) : "";
  return `${prefix}****${last4}`;
}

/**
 * transformList — applies a transformer to an array, filters nulls
 */
export function transformList(items, transformFn) {
  return (items ?? []).map(transformFn).filter(Boolean);
}
