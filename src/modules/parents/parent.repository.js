// =============================================================================
// modules/parents/parent.repository.js — RESQID
// =============================================================================

import { prisma } from '#config/prisma.js';

// ─── /me — Home data ──────────────────────────────────────────────────────────
// FIX: lastScan, anomaly, scanCount are now fetched per-student (active student
// scoped on the client), so getParentHomeData also returns per-student versions
// embedded on each student object.

export async function getParentHomeData(parentId) {
  const [parent, studentLinks] = await Promise.all([
    prisma.parentUser.findUnique({
      where: { id: parentId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        avatar_url: true,
        status: true,
        is_phone_verified: true,
        is_email_verified: true,
        active_student_id: true,
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

    // Full student tree
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
            gender: true,
            dob_encrypted: true,
            school: {
              select: { id: true, name: true, code: true, city: true },
            },
            tokens: {
              orderBy: [{ created_at: 'desc' }],
              take: 5,
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
                  select: { public_url: true, generated_at: true, is_active: true },
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
                  orderBy: { priority: 'asc' },
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
              select: { visibility: true, hidden_fields: true, updated_by_parent: true },
            },
            locationConsent: {
              select: { enabled: true },
            },
          },
        },
      },
    }),
  ]);

  if (!parent || !studentLinks) {
    return { parent, studentLinks: [], lastScan: null, anomaly: null, scanCount: 0 };
  }

  // FIX: Determine the active student id to scope global fields
  const activeStudentId =
    parent.active_student_id ??
    studentLinks.find(l => l.is_primary)?.student?.id ??
    studentLinks[0]?.student?.id ??
    null;

  // Fetch per-student scan summary for all linked students in parallel.
  // This gives the mobile client accurate data per child.
  const studentIds = studentLinks.map(l => l.student.id);

  const [perStudentScans, perStudentAnomalies, perStudentCounts] = await Promise.all([
    // Last scan per student - fetch all and group manually
    prisma.scanLog.findMany({
      where: {
        token: { student_id: { in: studentIds } },
      },
      orderBy: { created_at: 'desc' },
      take: studentIds.length * 5,
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
        token: { select: { student_id: true } },
      },
    }),

    // Latest unresolved anomaly per student
    prisma.scanAnomaly.findMany({
      where: {
        resolved: false,
        token: { student_id: { in: studentIds } },
      },
      orderBy: { created_at: 'desc' },
      take: studentIds.length * 3,
      select: {
        id: true,
        anomaly_type: true,
        severity: true,
        reason: true,
        created_at: true,
        token: { select: { student_id: true } },
      },
    }),

    // Scan count per student - use groupBy instead of Promise.all loop
    prisma.scanLog
      .groupBy({
        by: ['token_id'],
        where: {
          token: { student_id: { in: studentIds } },
        },
        _count: { id: true },
      })
      .then(async groups => {
        // Map token_id to student_id
        const tokenIds = groups.map(g => g.token_id);
        const tokens = await prisma.token.findMany({
          where: { id: { in: tokenIds } },
          select: { id: true, student_id: true },
        });
        const tokenToStudent = Object.fromEntries(tokens.map(t => [t.id, t.student_id]));

        // Aggregate counts per student
        const counts = {};
        for (const group of groups) {
          const sid = tokenToStudent[group.token_id];
          if (sid) {
            counts[sid] = (counts[sid] || 0) + group._count.id;
          }
        }
        return Object.entries(counts).map(([studentId, count]) => ({ studentId, count }));
      }),
  ]);

  // Build lookup maps: studentId → first matching record
  const lastScanByStudent = {};
  for (const scan of perStudentScans) {
    const sid = scan.token?.student_id;
    if (sid && !lastScanByStudent[sid]) {
      // eslint-disable-next-line no-unused-vars
      const { token, ...scanData } = scan;
      lastScanByStudent[sid] = scanData;
    }
  }

  const anomalyByStudent = {};
  for (const anomaly of perStudentAnomalies) {
    const sid = anomaly.token?.student_id;
    if (sid && !anomalyByStudent[sid]) {
      // eslint-disable-next-line no-unused-vars
      const { token, ...anomalyData } = anomaly;
      anomalyByStudent[sid] = anomalyData;
    }
  }

  const countByStudent = {};
  for (const { studentId, count } of perStudentCounts) {
    countByStudent[studentId] = count;
  }

  // Attach per-student scan data onto each studentLink
  const enrichedStudentLinks = studentLinks.map(link => ({
    ...link,
    student: {
      ...link.student,
      lastScan: lastScanByStudent[link.student.id] ?? null,
      anomaly: anomalyByStudent[link.student.id] ?? null,
      scanCount: countByStudent[link.student.id] ?? 0,
    },
  }));

  // Global fields scoped to the active student (for backwards-compat)
  const lastScan = activeStudentId ? (lastScanByStudent[activeStudentId] ?? null) : null;
  const anomaly = activeStudentId ? (anomalyByStudent[activeStudentId] ?? null) : null;
  const scanCount = activeStudentId ? (countByStudent[activeStudentId] ?? 0) : 0;

  return { parent, studentLinks: enrichedStudentLinks, lastScan, anomaly, scanCount };
}

// ─── /me/scans — Cursor-paginated scan history ────────────────────────────────
// FIX: added studentId parameter — queries are now scoped to a single student

export async function getScanHistory({ parentId, studentId, cursor, limit, filter }) {
  // Ownership check: make sure this student belongs to the parent
  const link = await prisma.parentStudent.findFirst({
    where: { parent_id: parentId, student_id: studentId },
  });
  if (!link) {
    throw Object.assign(new Error('Student not linked to this parent'), {
      code: 'FORBIDDEN',
      statusCode: 403,
    });
  }

  const where = buildScanWhere(studentId, filter);

  const rows = await prisma.scanLog.findMany({
    where,
    orderBy: { created_at: 'desc' },
    take: limit + 1,
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

  // Anomalies scoped to this student only
  const anomalies = await prisma.scanAnomaly.findMany({
    where: {
      token: { student_id: studentId },
    },
    orderBy: { created_at: 'desc' },
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

// FIX: buildScanWhere now scopes by student_id, not parent_id
function buildScanWhere(studentId, filter) {
  const base = {
    token: { student_id: studentId },
  };
  if (filter === 'emergency') return { ...base, scan_purpose: 'EMERGENCY' };
  if (filter === 'success') return { ...base, result: 'SUCCESS' };
  if (filter === 'flagged') return { ...base, result: { not: 'SUCCESS' } };
  return base;
}

// ─── /me/profile — Batched profile update ─────────────────────────────────────

export async function updateStudentProfile({ parentId, studentId, student, emergency, contacts }) {
  const link = await prisma.parentStudent.findFirst({
    where: { parent_id: parentId, student_id: studentId },
  });
  if (!link)
    throw Object.assign(new Error('Student not found or not linked to this parent'), {
      code: 'FORBIDDEN',
      statusCode: 403,
    });

  return prisma.$transaction(async tx => {
    const ops = [];

    if (student && Object.keys(student).length > 0) {
      ops.push(
        tx.student.update({
          where: { id: studentId },
          data: {
            ...student,
            ...(student.first_name && { setup_stage: 'COMPLETE' }),
          },
        })
      );
    }

    if (emergency) {
      ops.push(
        tx.emergencyProfile.upsert({
          where: { student_id: studentId },
          update: buildEmergencyData(emergency),
          create: { student_id: studentId, ...buildEmergencyData(emergency) },
        })
      );
    }

    if (contacts !== undefined) {
      const existingProfile = await tx.emergencyProfile.findUnique({
        where: { student_id: studentId },
        select: { id: true },
      });

      if (existingProfile) {
        ops.push(
          tx.emergencyContact.updateMany({
            where: { profile_id: existingProfile.id },
            data: { is_active: false },
          })
        );

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
                })
          );
        }
      }
    }

    for (const op of ops) {
      await op;
    }
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
  if (e.doctor_phone !== undefined) data.doctor_phone_encrypted = e.doctor_phone;
  if (e.notes !== undefined) data.notes = e.notes;
  return data;
}

function buildContactData(c) {
  return {
    name: c.name,
    phone_encrypted: c.phone,
    relationship: c.relationship,
    priority: c.priority,
    display_order: c.priority,
    call_enabled: true,
    whatsapp_enabled: true,
  };
}

// ─── /me/visibility ───────────────────────────────────────────────────────────

export async function updateCardVisibility({ parentId, student_id, visibility, hidden_fields }) {
  await verifyStudentOwnership(parentId, student_id);

  return prisma.cardVisibility.upsert({
    where: { student_id: student_id },
    update: { visibility, hidden_fields, updated_by_parent: true },
    create: { student_id: student_id, visibility, hidden_fields, updated_by_parent: true },
  });
}

// ─── /me/notifications ────────────────────────────────────────────────────────

export async function updateNotificationPrefs(parentId, prefs) {
  return prisma.parentNotificationPref.upsert({
    where: { parent_id: parentId },
    update: prefs,
    create: { parent_id: parentId, ...prefs },
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

  const updated = await prisma.token.updateMany({
    where: { student_id: studentId, status: 'ACTIVE' },
    data: { status: 'INACTIVE' },
  });

  if (updated.count === 0) {
    throw Object.assign(new Error('No active token found to lock'), {
      code: 'NO_ACTIVE_TOKEN',
      statusCode: 409,
    });
  }

  return { locked: true, count: updated.count };
}

// ─── /me/request-replace ─────────────────────────────────────────────────────

export async function createReplaceRequest({ parentId, student_id, reason }) {
  await verifyStudentOwnership(parentId, student_id);

  return prisma.parentEditLog.create({
    data: {
      student_id,
      parent_id: parentId,
      field_group: 'CARD_REPLACEMENT',
      new_value: { reason },
    },
    select: { id: true, created_at: true },
  });
}

// ─── /me (DELETE) ─────────────────────────────────────────────────────────────

export async function softDeleteParent(parentId) {
  return prisma.parentUser.update({
    where: { id: parentId },
    data: { status: 'DELETED', deleted_at: new Date() },
  });
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

async function verifyStudentOwnership(parentId, studentId) {
  const link = await prisma.parentStudent.findFirst({
    where: { parent_id: parentId, student_id: studentId },
  });
  if (!link) {
    throw Object.assign(new Error('Student not linked to this parent'), {
      code: 'FORBIDDEN',
      statusCode: 403,
    });
  }
}

// ─── /me/location-history ─────────────────────────────────────────────────────

export async function getLocationHistory({ parentId, studentId, cursor, limit, fromDate, toDate }) {
  await verifyStudentOwnership(parentId, studentId);

  const where = {
    student_id: studentId,
    ...(fromDate && { created_at: { gte: fromDate } }),
    ...(toDate && { created_at: { lte: toDate } }),
  };

  const rows = await prisma.locationEvent.findMany({
    where,
    orderBy: { created_at: 'desc' },
    take: limit + 1,
    ...(cursor && { cursor: { id: cursor }, skip: 1 }),
    select: {
      id: true,
      latitude: true,
      longitude: true,
      accuracy: true,
      source: true,
      created_at: true,
    },
  });

  const hasMore = rows.length > limit;
  if (hasMore) rows.pop();
  const nextCursor = hasMore ? (rows[rows.length - 1]?.id ?? null) : null;

  return { locations: rows, hasMore, nextCursor };
}

// ─── /me/anomalies ───────────────────────────────────────────────────────────

export async function getAnomalies(parentId, { cursor, limit, severity, resolved }) {
  const where = {
    token: {
      student: {
        parents: { some: { parent_id: parentId } },
      },
    },
    ...(severity && { severity }),
    ...(resolved !== undefined && { resolved }),
  };

  const rows = await prisma.scanAnomaly.findMany({
    where,
    orderBy: { created_at: 'desc' },
    take: limit + 1,
    ...(cursor && { cursor: { id: cursor }, skip: 1 }),
    include: {
      token: {
        select: {
          student: {
            select: { id: true, first_name: true, last_name: true },
          },
        },
      },
    },
  });

  const hasMore = rows.length > limit;
  if (hasMore) rows.pop();
  const nextCursor = hasMore ? (rows[rows.length - 1]?.id ?? null) : null;

  return { anomalies: rows, hasMore, nextCursor };
}

// ─── /me/cards ───────────────────────────────────────────────────────────────

export async function getCards(parentId) {
  return prisma.card.findMany({
    where: {
      student: { parents: { some: { parent_id: parentId } } },
    },
    include: {
      token: { select: { id: true, status: true, expires_at: true } },
      student: { select: { id: true, first_name: true, last_name: true } },
    },
    orderBy: { created_at: 'desc' },
  });
}

// ─── /me/request-renewal ─────────────────────────────────────────────────────

export async function requestRenewal(parentId, { cardId, paymentMethod }) {
  await verifyCardOwnership(parentId, cardId);

  const card = await prisma.card.findUnique({
    where: { id: cardId },
    include: { token: true, student: true },
  });

  if (!card) throw new Error('Card not found');

  const log = await prisma.parentEditLog.create({
    data: {
      student_id: card.student_id,
      parent_id: parentId,
      field_group: 'CARD_REPLACEMENT',
      new_value: {
        action: 'RENEWAL_REQUEST',
        card_id: cardId,
        payment_method: paymentMethod,
        current_expiry: card.token?.expires_at,
      },
    },
  });

  return { requestId: log.id, cardNumber: card.card_number };
}

async function verifyCardOwnership(parentId, cardId) {
  const card = await prisma.card.findFirst({
    where: {
      id: cardId,
      student: { parents: { some: { parent_id: parentId } } },
    },
  });

  if (!card) {
    throw Object.assign(new Error('Card not found or not linked to this parent'), {
      code: 'FORBIDDEN',
      statusCode: 403,
    });
  }

  return card;
}

// ─── Device token ─────────────────────────────────────────────────────────────

export async function upsertDeviceToken(
  parentId,
  { token, platform, device_name, deviceModel, os_version }
) {
  await prisma.parentDevice.updateMany({
    where: { expo_push_token: token, parent_id: { not: parentId } },
    data: { is_active: false, logged_out_at: new Date(), logout_reason: 'NEW_DEVICE_LOGIN' },
  });

  return prisma.parentDevice.upsert({
    where: { expo_push_token: token },
    update: {
      platform,
      device_name: device_name ?? null,
      device_model: deviceModel ?? null,
      os_version: os_version ?? null,
      is_active: true,
      last_seen_at: new Date(),
      logged_out_at: null,
      logout_reason: null,
    },
    create: {
      parent_id: parentId,
      expo_push_token: token,
      platform,
      device_name: device_name ?? null,
      device_model: deviceModel ?? null,
      os_version: os_version ?? null,
      is_active: true,
      last_seen_at: new Date(),
    },
    select: { id: true, platform: true, is_active: true, last_seen_at: true },
  });
}

// ─── Multi-child helpers ──────────────────────────────────────────────────────

export async function findCardByNumber(cardNumber) {
  return prisma.card.findUnique({
    where: { card_number: cardNumber },
    select: {
      id: true,
      student_id: true,
      school_id: true,
      student: {
        select: {
          first_name: true,
          setup_stage: true,
          is_active: true,
          parents: { select: { parent_id: true }, take: 1 },
        },
      },
    },
  });
}

export async function createStubStudent(schoolId, firstName) {
  return prisma.student.create({
    data: {
      school_id: schoolId,
      first_name: firstName || null,
      setup_stage: 'PENDING',
      is_active: true,
    },
    select: { id: true },
  });
}

export async function createEmergencyProfileForStudent(studentId) {
  return prisma.emergencyProfile.create({
    data: { student_id: studentId, visibility: 'HIDDEN', is_visible: false },
  });
}

export async function updateCardStudentId(cardId, studentId) {
  return prisma.card.update({ where: { id: cardId }, data: { student_id: studentId } });
}

export async function findParentStudentLink(parentId, studentId) {
  return prisma.parentStudent.findUnique({
    where: { parent_id_student_id: { parent_id: parentId, student_id: studentId } },
  });
}

export async function countParentChildren(parentId) {
  return prisma.parentStudent.count({ where: { parent_id: parentId } });
}

export async function createParentStudentLink(parentId, studentId, isPrimary) {
  return prisma.parentStudent.create({
    data: {
      parent_id: parentId,
      student_id: studentId,
      relationship: 'Parent',
      is_primary: isPrimary,
    },
  });
}

export async function findCardTokenId(cardId) {
  return prisma.card.findUnique({ where: { id: cardId }, select: { token_id: true } });
}

export async function activateTokenForStudent(tokenId, studentId) {
  return prisma.token.update({
    where: { id: tokenId },
    data: { student_id: studentId, status: 'ACTIVE' },
  });
}

export async function setParentActiveStudent(parentId, studentId) {
  return prisma.parentUser.update({
    where: { id: parentId },
    data: { active_student_id: studentId },
  });
}

export async function findParentEmail(parentId) {
  return prisma.parentUser.findUnique({
    where: { id: parentId },
    select: { email: true, name: true },
  });
}

export async function findParentPhone(parentId) {
  return prisma.parentUser.findUnique({
    where: { id: parentId },
    select: { phone: true, email: true, name: true },
  });
}

export async function findStudentById(studentId) {
  return prisma.student.findUnique({
    where: { id: studentId },
    select: { id: true, first_name: true, last_name: true },
  });
}

export async function deleteParentStudentLink(parentId, studentId) {
  return prisma.parentStudent.delete({
    where: { parent_id_student_id: { parent_id: parentId, student_id: studentId } },
  });
}

export async function deactivateTokenForStudent(studentId) {
  return prisma.token.updateMany({
    where: { student_id: studentId, status: 'ACTIVE' },
    data: { status: 'UNASSIGNED', student_id: null },
  });
}

export async function getRemainingChildrenCount(parentId) {
  return prisma.parentStudent.count({ where: { parent_id: parentId } });
}

export async function updateParentActiveStudent(parentId, newActiveStudentId) {
  return prisma.parentUser.update({
    where: { id: parentId },
    data: { active_student_id: newActiveStudentId },
  });
}
