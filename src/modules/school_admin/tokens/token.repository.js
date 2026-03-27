// =============================================================================
// modules/school_admin/tokens/tokens.repository.js — RESQID
// ALL Prisma calls for token inventory. Nothing else.
//
// PERFORMANCE STRATEGY
// ─────────────────────────────────────────────────────────────────────────────
// Two parallel query groups:
//
//   GROUP A (always runs together):
//     Q1: Token.findMany  — the page of tokens (skip/take)
//     Q2: Token.count     — total for current filter (pagination meta)
//
//   GROUP B (stats bar — runs once, cached in service layer):
//     Q3: Token.groupBy(status) — all status counts in ONE query
//         Avoids 4 separate COUNT queries for the stats bar
//
// SEARCH STRATEGY:
//   token_hash search → ILIKE on token_hash (prefix match — fast with index)
//   student search    → join through Student first_name/last_name
//   Both use OR — single query handles both cases
//
// INDEXES USED:
//   Token → @@index([school_id])          — base filter
//   Token → @@index([school_id, status])  — status filter hot path
//   Token → @@index([expires_at])         — expiry sort/filter
//   Token → @@index([student_id])         — student join
// =============================================================================

import { prisma } from '#config/database/prisma.js';

/**
 * findTokens({ schoolId, status, search, skip, take })
 * Returns: { tokens, total }
 */
export async function findTokens({ schoolId, status, search, skip, take }) {
  const where = buildWhere({ schoolId, status, search });

  const [rows, total] = await Promise.all([
    prisma.token.findMany({
      where,
      orderBy: { created_at: 'desc' },
      skip,
      take,
      select: {
        id: true,
        token_hash: true,
        status: true,
        assigned_at: true,
        expires_at: true,
        created_at: true,

        // Batch ID for display
        batch: {
          select: { id: true },
        },

        // Student name — nested select avoids N+1
        student: {
          select: {
            first_name: true,
            last_name: true,
          },
        },
      },
    }),

    prisma.token.count({ where }),
  ]);

  const tokens = rows.map(shapeToken);
  return { tokens, total };
}

/**
 * getTokenStats(schoolId)
 * Single groupBy query → all status counts in ONE DB round trip.
 * Result cached in service layer — no repeat DB hits on filter changes.
 * Returns: { ACTIVE, UNASSIGNED, ISSUED, EXPIRED, REVOKED, INACTIVE, total }
 */
export async function getTokenStats(schoolId) {
  const grouped = await prisma.token.groupBy({
    by: ['status'],
    where: { school_id: schoolId },
    _count: { status: true },
  });

  // Build stats object with safe defaults for any missing status
  const stats = {
    ACTIVE: 0,
    UNASSIGNED: 0,
    ISSUED: 0,
    EXPIRED: 0,
    REVOKED: 0,
    INACTIVE: 0,
  };

  let total = 0;
  for (const g of grouped) {
    stats[g.status] = g._count.status;
    total += g._count.status;
  }

  return { ...stats, total };
}

// ─── WHERE Builder ────────────────────────────────────────────────────────────

function buildWhere({ schoolId, status, search }) {
  const where = {
    school_id: schoolId,
    ...(status && status !== 'ALL' && { status }),
  };

  if (!search) return where;

  // Search: token_hash prefix OR student first/last name
  // token_hash is a hex string — ILIKE prefix match is efficient
  // student name search joins through relation — still one query
  where.OR = [
    { token_hash: { startsWith: search, mode: 'insensitive' } },
    {
      student: {
        OR: [
          { first_name: { contains: search, mode: 'insensitive' } },
          { last_name: { contains: search, mode: 'insensitive' } },
        ],
      },
    },
  ];

  return where;
}

// ─── Shape ────────────────────────────────────────────────────────────────────

function shapeToken(token) {
  return {
    id: token.id,
    token_hash: token.token_hash, // masked in frontend via maskTokenHash()
    status: token.status,
    assigned_at: token.assigned_at,
    expires_at: token.expires_at,
    created_at: token.created_at,
    batch_id: token.batch?.id ?? null,
    student_name: token.student
      ? `${token.student.first_name ?? ''} ${token.student.last_name ?? ''}`.trim()
      : null,
  };
}
