// =============================================================================
// modules/school_admin/students/students.repository.js — RESQID
// ALL Prisma calls for the students list. Nothing else.
//
// PERFORMANCE STRATEGY
// ─────────────────────────────────────────────────────────────────────────────
// The frontend was doing: fetch ALL students → filter in JS → paginate in JS
// This is wrong — for 1000+ students it sends a massive payload and kills perf.
//
// We move everything to the DB:
//   Search  → Prisma mode: insensitive contains on first_name + last_name
//   Filter  → WHERE clauses on class, section, token.status (via join)
//   Sort    → ORDER BY with whitelist (validated in students.validation.js)
//   Paginate → skip/take — only the requested page hits the wire
//
// INDEXES USED:
//   Student → @@index([school_id, is_active])   — base filter
//   Student → @@index([school_id])              — count query
//   Token   → @@index([school_id, status])      — token_status filter
//
// TWO QUERIES run in parallel:
//   Q1: findMany  — the actual page of students (skip/take)
//   Q2: count     — total matching rows for pagination meta
//   Both share the same WHERE clause — built once, used twice.
// =============================================================================

import { prisma } from "../../../config/prisma.js";

/**
 * findStudents({ schoolId, skip, take, search, class, section, tokenStatus, sortField, sortDir })
 *
 * Returns: { students: [...], total: number }
 *
 * Student shape (matches frontend columns exactly):
 * {
 *   id, first_name, last_name, class, section,
 *   is_active, created_at,
 *   token_status: string | null,   ← derived from latest token
 *   parent_linked: boolean          ← derived from ParentStudent count
 * }
 */
export async function findStudents({
  schoolId,
  skip,
  take,
  search,
  class: cls,
  section,
  tokenStatus,
  sortField,
  sortDir,
}) {
  // ── Build WHERE clause ────────────────────────────────────────────────────
  const where = {
    school_id: schoolId,
    is_active: true,
    deleted_at: null,

    // Search: case-insensitive match on first or last name
    // Prisma generates: WHERE (first_name ILIKE $1 OR last_name ILIKE $2)
    ...(search && {
      OR: [
        { first_name: { contains: search, mode: "insensitive" } },
        { last_name: { contains: search, mode: "insensitive" } },
      ],
    }),

    // Class filter — exact match on the class string e.g. "Class 6"
    ...(cls && { class: cls }),

    // Section filter — exact match e.g. "A"
    ...(section && { section }),

    // Token status filter — filter via the student's tokens relation
    // Uses @@index([school_id, status]) on Token table
    ...(tokenStatus && {
      tokens: {
        some: {
          school_id: schoolId,
          status: tokenStatus,
        },
      },
    }),
  };

  // ── Build ORDER BY ────────────────────────────────────────────────────────
  // sortField is whitelisted in validation — safe to use directly
  const orderBy =
    sortField === "first_name"
      ? [{ first_name: sortDir }, { last_name: sortDir }] // sort by full name
      : [{ [sortField]: sortDir }];

  // ── Run both queries in parallel ──────────────────────────────────────────
  const [rows, total] = await Promise.all([
    prisma.student.findMany({
      where,
      orderBy,
      skip,
      take,
      select: {
        id: true,
        first_name: true,
        last_name: true,
        class: true,
        section: true,
        is_active: true,
        created_at: true,

        // Token status: get the most recent token for this student
        // We only need the status — minimal select
        tokens: {
          where: { school_id: schoolId },
          select: { status: true },
          orderBy: { created_at: "desc" },
          take: 1, // only latest token
        },

        // Parent linked: check if any parent is linked
        // Using _count avoids fetching actual parent records
        _count: {
          select: { parents: true },
        },
      },
    }),

    prisma.student.count({ where }),
  ]);

  // ── Shape response to match frontend expectations ─────────────────────────
  const students = rows.map((s) => ({
    id: s.id,
    first_name: s.first_name,
    last_name: s.last_name,
    class: s.class,
    section: s.section,
    is_active: s.is_active,
    created_at: s.created_at,
    token_status: s.tokens[0]?.status ?? null, // null if no token assigned
    parent_linked: s._count.parents > 0, // true if at least one parent
  }));

  return { students, total };
}
