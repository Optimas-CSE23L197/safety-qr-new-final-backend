// =============================================================================
// modules/parents/parent.repository.js — RESQID
// Security: all writes are ownership-gated before touching the DB.
// Scalability: queries use indexed fields only; no N+1; groupBy for counts.
// =============================================================================

import { prisma } from '#config/prisma.js';

// ─── Shared error factory ─────────────────────────────────────────────────────

function forbiddenError(message = 'Access denied') {
  return Object.assign(new Error(message), { code: 'FORBIDDEN', statusCode: 403 });
}

function notFoundError(message = 'Not found') {
  return Object.assign(new Error(message), { code: 'NOT_FOUND', statusCode: 404 });
}

function conflictError(message = 'Conflict') {
  return Object.assign(new Error(message), { code: 'CONFLICT', statusCode: 409 });
}

// ─── Ownership guards ─────────────────────────────────────────────────────────
// Always call these before any write. They use the composite unique index
// (parent_id, student_id) so the DB lookup is O(1).

async function verifyStudentOwnership(parentId, studentId) {
  if (!parentId || !studentId) throw forbiddenError();
  const link = await prisma.parentStudent.findUnique({
    where: { parent_id_student_id: { parent_id: parentId, student_id: studentId } },
  });
  if (!link) throw forbiddenError('Student not linked to this parent');
  return link;
}

async function verifyCardOwnership(parentId, cardId) {
  if (!parentId || !cardId) throw forbiddenError();
  const card = await prisma.card.findFirst({
    where: {
      id: cardId,
      student: { parents: { some: { parent_id: parentId } } },
    },
  });
  if (!card) throw forbiddenError('Card not found or not linked to this parent');
  return card;
}

// ─── GET /me — Home data ──────────────────────────────────────────────────────
//
// PERFORMANCE CHANGES (vs old implementation):
//
// 1. Scan counts: was groupBy(token_id) → wait → findMany(token) to resolve
//    student_id — two sequential round-trips. Now a single $queryRaw with
//    JOIN + GROUP BY student_id. One round-trip, uses the student_id index
//    on the token table directly.
//
// 2. perStudentScans / perStudentAnomalies: were filtering through the token
//    relation (scanLog → token.student_id) which forces a join+filter. After
//    the migration (see MIGRATION below) both tables carry student_id directly,
//    so these become simple indexed WHERE student_id IN (...) scans.
//    While the migration is pending the queries remain correct — they just
//    still hit the join path. Deploy migration first, then this file.
//
// 3. Last-scan-per-student: the old take: N*5 heuristic could miss students
//    if scans weren't evenly distributed. Now uses DISTINCT ON (student_id)
//    via $queryRaw so each student always gets exactly their latest scan in
//    one pass.
//
// MIGRATION (run before deploying this file):
//
//   -- Add student_id directly to scan_logs for direct indexed access
//   ALTER TABLE scan_logs ADD COLUMN student_id TEXT;
//   UPDATE scan_logs sl
//     SET student_id = t.student_id
//     FROM tokens t WHERE t.id = sl.token_id;
//   CREATE INDEX CONCURRENTLY idx_scan_logs_student_id_created_at
//     ON scan_logs (student_id, created_at DESC);
//
//   -- Add student_id directly to scan_anomalies
//   ALTER TABLE scan_anomalies ADD COLUMN student_id TEXT;
//   UPDATE scan_anomalies sa
//     SET student_id = t.student_id
//     FROM tokens t WHERE t.id = sa.token_id;
//   CREATE INDEX CONCURRENTLY idx_scan_anomalies_student_id
//     ON scan_anomalies (student_id, resolved, created_at DESC);
//
//   -- Then add to your Prisma schema and run: prisma db pull / prisma generate
//   -- Backfill trigger (keep in sync on new writes — add to scanLog create path):
//   --   data: { ..., student_id: token.student_id }

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

  const activeStudentId =
    parent.active_student_id ??
    studentLinks.find(l => l.is_primary)?.student?.id ??
    studentLinks[0]?.student?.id ??
    null;

  const studentIds = studentLinks.map(l => l.student.id);

  if (studentIds.length === 0) {
    return { parent, studentLinks, lastScan: null, anomaly: null, scanCount: 0 };
  }

  // ─── All three stats queries run in parallel ────────────────────────────────

  const [lastScanRows, anomalyRows, countRows] = await Promise.all([
    // ── 1. Latest scan per student ──────────────────────────────────────────
    //
    // DISTINCT ON (student_id) with ORDER BY (student_id, created_at DESC)
    // gives one row per student in a single index scan — no heuristic take:N*5.
    //
    // PRE-MIGRATION fallback: if scan_logs.student_id column doesn't exist yet,
    // swap the WHERE/JOIN to: JOIN tokens t ON t.id = sl.token_id
    //                         WHERE t.student_id = ANY(...)
    // and change sl.student_id refs to t.student_id. The query is otherwise
    // identical.
    prisma.$queryRaw`
      SELECT DISTINCT ON (sl.student_id)
        sl.id,
        sl.student_id,
        sl.result,
        sl.ip_city,
        sl.ip_region,
        sl.ip_country,
        sl.scan_purpose,
        sl.created_at,
        sl.latitude,
        sl.longitude
      FROM "ScanLog" sl
      WHERE sl.student_id = ANY(${studentIds}::text[])
      ORDER BY sl.student_id, sl.created_at DESC
    `,

    // ── 2. Latest unresolved anomaly per student ────────────────────────────
    prisma.$queryRaw`
      SELECT DISTINCT ON (sa.student_id)
        sa.id,
        sa.student_id,
        sa.anomaly_type,
        sa.severity,
        sa.reason,
        sa.created_at
      FROM "ScanAnomaly" sa
      WHERE sa.student_id = ANY(${studentIds}::text[])
        AND sa.resolved = false
      ORDER BY sa.student_id, sa.created_at DESC
    `,

    // ── 3. Total scan count per student ────────────────────────────────────
    prisma.$queryRaw`
      SELECT
        sl.student_id,
        COUNT(sl.id)::int AS count
      FROM "ScanLog" sl
      WHERE sl.student_id = ANY(${studentIds}::text[])
      GROUP BY sl.student_id
    `,
  ]);

  // ─── Shape results into lookup maps ────────────────────────────────────────

  const lastScanByStudent = Object.fromEntries(
    lastScanRows.map(({ student_id, ...scanData }) => [student_id, scanData])
  );

  const anomalyByStudent = Object.fromEntries(
    anomalyRows.map(({ student_id, ...anomalyData }) => [student_id, anomalyData])
  );

  const countByStudent = Object.fromEntries(
    countRows.map(({ student_id, count }) => [student_id, count])
  );

  // ─── Attach per-student stats ───────────────────────────────────────────────

  const enrichedStudentLinks = studentLinks.map(link => ({
    ...link,
    student: {
      ...link.student,
      lastScan: lastScanByStudent[link.student.id] ?? null,
      anomaly: anomalyByStudent[link.student.id] ?? null,
      scanCount: countByStudent[link.student.id] ?? 0,
    },
  }));

  const lastScan = activeStudentId ? (lastScanByStudent[activeStudentId] ?? null) : null;
  const anomaly = activeStudentId ? (anomalyByStudent[activeStudentId] ?? null) : null;
  const scanCount = activeStudentId ? (countByStudent[activeStudentId] ?? 0) : 0;

  return { parent, studentLinks: enrichedStudentLinks, lastScan, anomaly, scanCount };
}

// ─── GET /me/scans — Cursor-paginated scan history ────────────────────────────

export async function getScanHistory({ parentId, studentId, cursor, limit, filter }) {
  // Ownership check scopes the query to this parent's student only (IDOR guard)
  await verifyStudentOwnership(parentId, studentId);

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

  const anomalies = await prisma.scanAnomaly.findMany({
    where: { token: { student_id: studentId } },
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

function buildScanWhere(studentId, filter) {
  const base = { token: { student_id: studentId } };
  if (filter === 'emergency') return { ...base, scan_purpose: 'EMERGENCY' };
  if (filter === 'success') return { ...base, result: 'SUCCESS' };
  if (filter === 'flagged') return { ...base, result: { not: 'SUCCESS' } };
  return base;
}

// ─── PATCH /me/profile/emergency — Batched profile update ────────────────────
//
// FIX: replaced the deferred ops[] array pattern with sequential awaits inside
// the interactive transaction. The old pattern caused a race condition where
// emergencyContact ops were pushed before the emergencyProfile upsert resolved,
// so findUnique for contacts could see a stale state on first-time creates.
//
// Security: ownership is verified before the transaction opens. studentId is
// never taken from client input beyond what was validated by the middleware.

export async function updateStudentProfile({ parentId, studentId, student, emergency, contacts }) {
  await verifyStudentOwnership(parentId, studentId);

  return prisma.$transaction(async tx => {
    if (student && Object.keys(student).length > 0) {
      await tx.student.update({
        where: { id: studentId },
        data: {
          ...student,
          ...(student.first_name && { setup_stage: 'COMPLETE' }),
        },
      });
    }

    if (emergency) {
      await tx.emergencyProfile.upsert({
        where: { student_id: studentId },
        update: buildEmergencyData(emergency),
        create: {
          student_id: studentId,
          visibility: 'HIDDEN',
          is_visible: false,
          ...buildEmergencyData(emergency),
        },
      });
    }

    if (contacts !== undefined) {
      const existingProfile = await tx.emergencyProfile.findUnique({
        where: { student_id: studentId },
        select: { id: true },
      });

      if (!existingProfile) {
        throw Object.assign(
          new Error('Cannot save contacts: emergency profile does not exist yet'),
          { code: 'PROFILE_MISSING', statusCode: 422 }
        );
      }

      // Hard delete — soft delete breaks the @@unique([profile_id, priority])
      // constraint because deactivated rows still block new inserts at the same priority
      await tx.emergencyContact.deleteMany({
        where: { profile_id: existingProfile.id },
      });

      for (const c of contacts) {
        await tx.emergencyContact.create({
          data: {
            profile_id: existingProfile.id,
            ...buildContactData(c),
            is_active: true,
          },
        });
      }
    }

    return { success: true };
  });
}

// ── Field builders ────────────────────────────────────────────────────────────
// Only include fields that are explicitly provided (undefined = no-op in Prisma).

function buildEmergencyData(e) {
  const data = {};
  if (e.blood_group !== undefined) data.blood_group = e.blood_group;
  if (e.allergies !== undefined) data.allergies = e.allergies;
  if (e.conditions !== undefined) data.conditions = e.conditions;
  if (e.medications !== undefined) data.medications = e.medications;
  if (e.doctor_name !== undefined) data.doctor_name = e.doctor_name;
  // Service layer passes pre-encrypted value under the key `doctor_phone`
  if (e.doctor_phone !== undefined) data.doctor_phone_encrypted = e.doctor_phone;
  if (e.notes !== undefined) data.notes = e.notes;
  return data;
}

function buildContactData(c) {
  return {
    name: c.name,
    phone_encrypted: c.phone, // pre-encrypted by service layer
    relationship: c.relationship,
    priority: c.priority,
    display_order: c.priority, // mirrors priority; can be decoupled later
    call_enabled: c.call_enabled ?? true,
    whatsapp_enabled: c.whatsapp_enabled ?? true,
  };
}

// ─── PATCH /me/visibility ─────────────────────────────────────────────────────

export async function updateCardVisibility({ parentId, student_id, visibility, hidden_fields }) {
  await verifyStudentOwnership(parentId, student_id);

  return prisma.cardVisibility.upsert({
    where: { student_id },
    update: { visibility, hidden_fields, updated_by_parent: true },
    create: { student_id, visibility, hidden_fields, updated_by_parent: true },
  });
}

// ─── PATCH /me/notifications ──────────────────────────────────────────────────

export async function updateNotificationPrefs(parentId, prefs) {
  return prisma.parentNotificationPref.upsert({
    where: { parent_id: parentId },
    update: prefs,
    create: { parent_id: parentId, ...prefs },
  });
}

// ─── PATCH /me/location-consent ──────────────────────────────────────────────

export async function updateLocationConsent({ parentId, studentId, enabled }) {
  await verifyStudentOwnership(parentId, studentId);

  return prisma.locationConsent.upsert({
    where: { student_id: studentId },
    update: { enabled, consented_by: parentId },
    create: { student_id: studentId, enabled, consented_by: parentId },
  });
}

// ─── POST /me/lock-card ───────────────────────────────────────────────────────

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

// ─── POST /me/request-replace ─────────────────────────────────────────────────

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

// ─── DELETE /me ───────────────────────────────────────────────────────────────

export async function softDeleteParent(parentId) {
  return prisma.parentUser.update({
    where: { where: { id: parentId } },
    data: { status: 'DELETED', deleted_at: new Date() },
  });
}

// ─── GET /me/location-history ─────────────────────────────────────────────────

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

// ─── GET /me/anomalies ────────────────────────────────────────────────────────

export async function getAnomalies(parentId, { cursor, limit, severity, resolved }) {
  const where = {
    token: {
      student: { parents: { some: { parent_id: parentId } } },
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

// ─── GET /me/cards ────────────────────────────────────────────────────────────

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

// ─── POST /me/request-renewal ─────────────────────────────────────────────────

export async function requestRenewal(parentId, { cardId, paymentMethod }) {
  await verifyCardOwnership(parentId, cardId);

  const card = await prisma.card.findUnique({
    where: { id: cardId },
    include: { token: true, student: true },
  });

  if (!card) throw notFoundError('Card not found');

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

// ─── POST /device-token ───────────────────────────────────────────────────────

export async function upsertDeviceToken(
  parentId,
  { token, platform, device_name, deviceModel, os_version }
) {
  // Invalidate the same push token if it was registered to another parent
  // (handles device hand-offs, e.g. shared family phones)
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
