// =============================================================================
// modules/parents/parent.repository.js — RESQID
// ALL Prisma calls for the parent app. Nothing else.
// =============================================================================

import { prisma } from "../../config/prisma.js";

// ─── /me — Home data ──────────────────────────────────────────────────────────

export async function getParentHomeData(parentId) {
  const [parent, studentLinks, lastScan, anomaly, scanCount] =
    await Promise.all([
      prisma.parentUser.findUnique({
        where: { id: parentId },
        select: {
          id: true,
          name: true,
          status: true,
          is_phone_verified: true,
          notificationPrefs: {
            select: {
              scan_notify_enabled: true,
              scan_notify_push: true,
              scan_notify_sms: true,
              anomaly_notify_push: true,
              anomaly_notify_sms: true,
              card_expiry_notify: true,
              quiet_hours_enabled: true,
              quiet_hours_start: true,
              quiet_hours_end: true,
            },
          },
        },
      }),

      // Full student tree — zero N+1
      prisma.parentStudent.findMany({
        where: { parent_id: parentId },
        select: {
          relationship: true,
          is_primary: true,
          student: {
            select: {
              id: true,
              first_name: true,
              last_name: true,
              class: true,
              section: true,
              photo_url: true,
              setup_stage: true,
              school: {
                select: { id: true, name: true, code: true, city: true },
              },
              tokens: {
                where: { status: { not: "REVOKED" } },
                orderBy: [
                  { activated_at: { sort: "desc", nulls: "last" } },
                  { created_at: "desc" },
                ],
                take: 1,
                select: {
                  id: true,
                  status: true,
                  expires_at: true,
                  activated_at: true,
                  assigned_at: true,
                  cards: {
                    take: 1,
                    select: { card_number: true },
                  },
                  qrAsset: {
                    select: {
                      public_url: true,
                      generated_at: true,
                      is_active: true,
                    },
                  },
                },
              },
              emergency: {
                select: {
                  blood_group: true,
                  allergies: true,
                  conditions: true,
                  medications: true,
                  doctor_name: true,
                  doctor_phone_encrypted: true,
                  notes: true,
                  visibility: true,
                  is_visible: true,
                  contacts: {
                    where: { is_active: true },
                    orderBy: { priority: "asc" },
                    select: {
                      id: true,
                      name: true,
                      phone_encrypted: true,
                      relationship: true,
                      priority: true,
                      display_order: true,
                      call_enabled: true,
                      whatsapp_enabled: true,
                    },
                  },
                },
              },
              cardVisibility: {
                select: {
                  visibility: true,
                  hidden_fields: true,
                  updated_by_parent: true,
                },
              },
              locationConsent: {
                select: { enabled: true },
              },
            },
          },
        },
      }),

      // Last scan across all students
      prisma.scanLog.findFirst({
        where: {
          token: { student: { parents: { some: { parent_id: parentId } } } },
        },
        orderBy: { created_at: "desc" },
        select: {
          id: true,
          result: true,
          ip_city: true,
          ip_region: true,
          ip_country: true,
          scan_purpose: true,
          created_at: true,
          latitude: true,
          longitude: true,
        },
      }),

      // Unresolved anomaly
      prisma.scanAnomaly.findFirst({
        where: {
          resolved: false,
          token: { student: { parents: { some: { parent_id: parentId } } } },
        },
        orderBy: { created_at: "desc" },
        select: {
          id: true,
          anomaly_type: true,
          severity: true,
          reason: true,
          created_at: true,
        },
      }),

      // Total scan count
      prisma.scanLog.count({
        where: {
          token: { student: { parents: { some: { parent_id: parentId } } } },
        },
      }),
    ]);

  return { parent, studentLinks, lastScan, anomaly, scanCount };
}

// ─── /me/scans — Cursor-paginated scan history ────────────────────────────────

export async function getScanHistory({ parentId, cursor, limit, filter }) {
  const where = buildScanWhere(parentId, filter);

  const rows = await prisma.scanLog.findMany({
    where,
    orderBy: { created_at: "desc" },
    take: limit + 1, // fetch one extra to detect hasMore
    ...(cursor && { cursor: { id: cursor }, skip: 1 }),
    select: {
      id: true,
      result: true,
      scan_purpose: true,
      ip_city: true,
      ip_region: true,
      ip_country: true,
      ip_address: true,
      latitude: true,
      longitude: true,
      created_at: true,
      user_agent: true,
    },
  });

  const hasMore = rows.length > limit;
  if (hasMore) rows.pop();
  const nextCursor = hasMore ? (rows[rows.length - 1]?.id ?? null) : null;

  // Also fetch anomalies for this parent in parallel
  const anomalies = await prisma.scanAnomaly.findMany({
    where: {
      token: { student: { parents: { some: { parent_id: parentId } } } },
    },
    orderBy: { created_at: "desc" },
    take: 20,
    select: {
      id: true,
      anomaly_type: true,
      severity: true,
      reason: true,
      resolved: true,
      created_at: true,
    },
  });

  return { scans: rows, anomalies, hasMore, nextCursor };
}

function buildScanWhere(parentId, filter) {
  const base = {
    token: { student: { parents: { some: { parent_id: parentId } } } },
  };
  if (filter === "emergency") return { ...base, scan_purpose: "EMERGENCY" };
  if (filter === "success") return { ...base, result: "SUCCESS" };
  if (filter === "flagged") return { ...base, result: { not: "SUCCESS" } };
  return base;
}

// ─── /me/profile — Batched profile update ─────────────────────────────────────

export async function updateStudentProfile({
  parentId,
  studentId,
  student,
  emergency,
  contacts,
}) {
  // Verify ownership first — parent must own this student
  const link = await prisma.parentStudent.findFirst({
    where: { parent_id: parentId, student_id: studentId },
  });
  if (!link)
    throw Object.assign(
      new Error("Student not found or not linked to this parent"),
      { code: "FORBIDDEN", statusCode: 403 },
    );

  return prisma.$transaction(async (tx) => {
    const ops = [];

    // Update student fields if provided
    if (student && Object.keys(student).length > 0) {
      ops.push(
        tx.student.update({
          where: { id: studentId },
          data: student,
        }),
      );
    }

    // Update emergency profile if provided
    if (emergency) {
      ops.push(
        tx.emergencyProfile.upsert({
          where: { student_id: studentId },
          update: buildEmergencyData(emergency),
          create: { student_id: studentId, ...buildEmergencyData(emergency) },
        }),
      );
    }

    // Replace contacts atomically if provided
    // Soft approach: deactivate old, upsert new by id (edit) or create (new)
    if (contacts !== undefined) {
      // Get existing contact IDs for this student
      const existingProfile = await tx.emergencyProfile.findUnique({
        where: { student_id: studentId },
        select: { id: true },
      });

      if (existingProfile) {
        // Deactivate all existing contacts
        ops.push(
          tx.emergencyContact.updateMany({
            where: { profile_id: existingProfile.id },
            data: { is_active: false },
          }),
        );

        // Upsert each contact in new list
        for (const c of contacts) {
          ops.push(
            c.id
              ? tx.emergencyContact.update({
                  where: { id: c.id },
                  data: { ...buildContactData(c), is_active: true },
                })
              : tx.emergencyContact.create({
                  data: {
                    profile_id: existingProfile.id,
                    ...buildContactData(c),
                    is_active: true,
                  },
                }),
          );
        }
      }
    }

    await Promise.all(ops);
    return { success: true };
  });
}

function buildEmergencyData(e) {
  const data = {};
  if (e.blood_group !== undefined) data.blood_group = e.blood_group;
  if (e.allergies !== undefined) data.allergies = e.allergies;
  if (e.conditions !== undefined) data.conditions = e.conditions;
  if (e.medications !== undefined) data.medications = e.medications;
  if (e.doctor_name !== undefined) data.doctor_name = e.doctor_name;
  if (e.notes !== undefined) data.notes = e.notes;
  return data;
}

function buildContactData(c) {
  return {
    name: c.name,
    phone_encrypted: c.phone, // encrypted in service layer before hitting repo
    relationship: c.relationship,
    priority: c.priority,
    display_order: c.priority,
    call_enabled: true,
    whatsapp_enabled: true,
  };
}

// ─── /me/visibility ───────────────────────────────────────────────────────────

export async function updateCardVisibility({
  parentId,
  studentId,
  visibility,
  hidden_fields,
}) {
  await verifyStudentOwnership(parentId, studentId);

  return prisma.cardVisibility.upsert({
    where: { student_id: studentId },
    update: { visibility, hidden_fields, updated_by_parent: true },
    create: {
      student_id: studentId,
      visibility,
      hidden_fields,
      updated_by_parent: true,
    },
  });
}

// ─── /me/notifications ────────────────────────────────────────────────────────

export async function updateNotificationPrefs(parentId, prefs) {
  return prisma.parentNotificationPref.update({
    where: { parent_id: parentId },
    data: prefs,
  });
}

// ─── /me/location-consent ────────────────────────────────────────────────────

export async function updateLocationConsent({ parentId, studentId, enabled }) {
  await verifyStudentOwnership(parentId, studentId);

  return prisma.locationConsent.upsert({
    where: { student_id: studentId },
    update: { enabled, consented_by: parentId },
    create: { student_id: studentId, enabled, consented_by: parentId },
  });
}

// ─── /me/lock-card ───────────────────────────────────────────────────────────

export async function lockStudentCard({ parentId, studentId }) {
  await verifyStudentOwnership(parentId, studentId);

  // Deactivate the student's active token
  const updated = await prisma.token.updateMany({
    where: { student_id: studentId, status: "ACTIVE" },
    data: { status: "INACTIVE" },
  });

  if (updated.count === 0) {
    throw Object.assign(new Error("No active token found to lock"), {
      code: "NO_ACTIVE_TOKEN",
      statusCode: 409,
    });
  }

  return { locked: true, count: updated.count };
}

// ─── /me/request-replace ─────────────────────────────────────────────────────

export async function createReplaceRequest({ parentId, studentId, reason }) {
  await verifyStudentOwnership(parentId, studentId);

  // Log the replacement request as a ParentEditLog entry
  return prisma.parentEditLog.create({
    data: {
      student_id: studentId,
      parent_id: parentId,
      field_group: "CARD_REPLACEMENT",
      new_value: { reason },
    },
    select: { id: true, created_at: true },
  });
}

// ─── /me (DELETE) — Account deletion ─────────────────────────────────────────

export async function softDeleteParent(parentId) {
  return prisma.parentUser.update({
    where: { id: parentId },
    data: {
      status: "DELETED",
      deleted_at: new Date(),
    },
  });
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

async function verifyStudentOwnership(parentId, studentId) {
  const link = await prisma.parentStudent.findFirst({
    where: { parent_id: parentId, student_id: studentId },
  });
  if (!link) {
    throw Object.assign(new Error("Student not linked to this parent"), {
      code: "FORBIDDEN",
      statusCode: 403,
    });
  }
}
