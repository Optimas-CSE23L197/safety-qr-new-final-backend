// =============================================================================
// modules/school_admin/anomalies/anomaly.repository.js — RESQID
// ALL Prisma calls for scan anomalies. Nothing else.
//
// PERFORMANCE STRATEGY
// ─────────────────────────────────────────────────────────────────────────────
// ScanAnomaly has NO school_id column — school scope is enforced via:
//   WHERE token.school_id = schoolId
// Prisma translates this into a JOIN on token.
//
// GROUP A (always parallel):
//   Q1: ScanAnomaly.findMany  — paginated rows (skip/take)
//   Q2: ScanAnomaly.count     — total for current filter
//
// GROUP B (stats — cached in service layer):
//   Q3: ScanAnomaly.count(resolved:false, school)  — unresolved badge count
//       Intentionally a simple count, not groupBy — all the frontend needs
//       is the unresolved integer for the red badge in the header.
//
// RESOLVE WRITE:
//   Q4: ScanAnomaly.update — sets resolved + resolved_at + resolved_by + notes
//       Ownership check embedded: WHERE id = anomalyId AND token.school_id = schoolId
//       If 0 rows updated → 404 (anomaly not found or belongs to another school)
//
// INDEXES USED (from schema):
//   ScanAnomaly → @@index([token_id])       — school-scope join
//   ScanAnomaly → @@index([resolved])       — UNRESOLVED/RESOLVED filter hot path
//   ScanAnomaly → @@index([anomaly_type])   — type filter
//   ScanAnomaly → @@index([created_at])     — sort
//   Token       → @@index([school_id])      — school-scope guard
// =============================================================================

import { prisma } from "../../../config/prisma.js";

/**
 * findAnomalies({ schoolId, filter, type, skip, take })
 * Returns: { anomalies, total }
 */
export async function findAnomalies({ schoolId, filter, type, skip, take }) {
  const where = buildWhere({ schoolId, filter, type });

  const [rows, total] = await Promise.all([
    prisma.scanAnomaly.findMany({
      where,
      orderBy: [
        // Unresolved always float to top within each group
        { resolved: "asc" },
        { created_at: "desc" },
      ],
      skip,
      take,
      select: {
        id: true,
        anomaly_type: true,
        severity: true,
        reason: true,
        resolved: true,
        resolved_at: true,
        resolved_by: true,
        // notes stored in metadata JSON field — see shapeAnomaly()
        metadata: true,
        created_at: true,

        // Join through token to get school guard + student name + token_hash
        token: {
          select: {
            token_hash: true,
            school_id: true, // already filtered in WHERE — kept for shape safety

            // Most recent ScanLog for this token — get ip/device context
            // Only the latest scan is relevant for anomaly display
            scans: {
              orderBy: { created_at: "desc" },
              take: 1,
              select: {
                ip_address: true,
                ip_city: true,
                user_agent: true,
              },
            },

            student: {
              select: {
                first_name: true,
                last_name: true,
              },
            },
          },
        },
      },
    }),

    prisma.scanAnomaly.count({ where }),
  ]);

  const anomalies = rows.map(shapeAnomaly);
  return { anomalies, total };
}

/**
 * getAnomalyStats(schoolId)
 * Returns: { unresolved }
 * Cached in service layer — invalidated on any resolve action.
 */
export async function getAnomalyStats(schoolId) {
  const unresolved = await prisma.scanAnomaly.count({
    where: {
      resolved: false,
      token: { school_id: schoolId },
    },
  });

  return { unresolved };
}

/**
 * resolveAnomaly({ anomalyId, schoolId, resolvedBy, notes })
 *
 * Ownership check is baked into the WHERE:
 *   token.school_id must equal schoolId
 * If the anomaly doesn't exist or belongs to another school → returns null.
 *
 * Returns: shaped anomaly | null
 */
export async function resolveAnomaly({
  anomalyId,
  schoolId,
  resolvedBy,
  notes,
}) {
  // updateMany used instead of update because Prisma's update()
  // doesn't support nested relation filters in WHERE for ownership check.
  // updateMany returns { count } — 0 means not found or wrong school.
  const result = await prisma.scanAnomaly.updateMany({
    where: {
      id: anomalyId,
      resolved: false, // idempotency guard — don't re-resolve
      token: { school_id: schoolId },
    },
    data: {
      resolved: true,
      resolved_at: new Date(),
      resolved_by: resolvedBy,
      // Store resolution note inside metadata JSON
      // Schema has no dedicated notes column — metadata is the right field
      metadata: {
        resolution_notes: notes ?? null,
        resolved_by_id: resolvedBy,
      },
    },
  });

  if (result.count === 0) return null;

  // Fetch the updated row to return shaped data
  const updated = await prisma.scanAnomaly.findUnique({
    where: { id: anomalyId },
    select: {
      id: true,
      anomaly_type: true,
      severity: true,
      reason: true,
      resolved: true,
      resolved_at: true,
      resolved_by: true,
      metadata: true,
      created_at: true,
      token: {
        select: {
          token_hash: true,
          school_id: true,
          scans: {
            orderBy: { created_at: "desc" },
            take: 1,
            select: { ip_address: true, ip_city: true, user_agent: true },
          },
          student: {
            select: { first_name: true, last_name: true },
          },
        },
      },
    },
  });

  return updated ? shapeAnomaly(updated) : null;
}

// ─── WHERE Builder ────────────────────────────────────────────────────────────

function buildWhere({ schoolId, filter, type }) {
  const where = {
    // School-scope enforced via token relation — no school_id on ScanAnomaly
    token: { school_id: schoolId },
  };

  // Resolved filter
  if (filter === "UNRESOLVED") where.resolved = false;
  else if (filter === "RESOLVED") where.resolved = true;
  // "ALL" — no resolved filter

  // Anomaly type filter
  if (type && type !== "ALL") {
    where.anomaly_type = type;
  }

  return where;
}

// ─── Shape ────────────────────────────────────────────────────────────────────

function shapeAnomaly(anomaly) {
  const latestScan = anomaly.token?.scans?.[0] ?? null;
  const { browser, platform } = parseUserAgent(latestScan?.user_agent);

  // Extract resolution notes from metadata JSON
  const resolutionNotes = anomaly.metadata?.resolution_notes ?? null;

  return {
    id: anomaly.id,
    type: anomaly.anomaly_type,
    severity: anomaly.severity,
    reason: anomaly.reason,
    token_hash: anomaly.token?.token_hash ?? null,
    student_name: anomaly.token?.student
      ? `${anomaly.token.student.first_name ?? ""} ${anomaly.token.student.last_name ?? ""}`.trim() ||
        null
      : null,
    // Location/device from most recent scan on this token
    ip_address: latestScan?.ip_address ?? null,
    ip_city: latestScan?.ip_city ?? null,
    device: browser && platform ? `${browser}/${platform}` : null,
    // Resolution fields
    resolved: anomaly.resolved,
    resolved_at: anomaly.resolved_at,
    notes: resolutionNotes,
    created_at: anomaly.created_at,
  };
}

/**
 * Lightweight UA parser — same as scanlog.repository.js.
 * Returns { browser, platform } for "Chrome/Android" display format.
 */
function parseUserAgent(ua) {
  if (!ua) return { browser: null, platform: null };

  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Firefox\//.test(ua)
          ? "Firefox"
          : /Safari\//.test(ua)
            ? "Safari"
            : "Browser";

  const platform = /Android/.test(ua)
    ? "Android"
    : /iPhone|iPad/.test(ua)
      ? "iOS"
      : /Windows/.test(ua)
        ? "Windows"
        : /Linux/.test(ua)
          ? "Linux"
          : /Mac/.test(ua)
            ? "macOS"
            : "Unknown";

  return { browser, platform };
}
