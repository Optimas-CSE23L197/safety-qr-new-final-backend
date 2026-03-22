// =============================================================================
// modules/school_admin/qr/qr.service.js — RESQID
// Responsibility: orchestration + caching. No Prisma.
//
// CACHE STRATEGY
// ─────────────────────────────────────────────────────────────────────────────
// Student QR detail (right panel):
//   Key:  qr:student:{studentId}
//   TTL:  5 minutes
//   Why:  QR asset URL is stable (CDN, doesn't change unless regenerated)
//         Token status changes rarely — 5min staleness acceptable
//   Invalidate when: token assigned/revoked, QR regenerated
//
// Student list (left panel):
//   NOT cached — search/filter/pagination combos make it impractical
//   List query is fast with indexes — no need
//
// Token assignment:
//   After assign → invalidate student cache + token stats cache
// =============================================================================

import * as repo from "./qr.repository.js";
import { cacheAside, cacheDel } from "../../../utils/cache/cache.js";
import { buildOffsetMeta } from "../../../utils/response/paginate.js";
import { invalidateTokenStats } from "../tokens/token.service.js";

const STUDENT_QR_KEY = (studentId) => `qr:student:${studentId}`;
const STUDENT_QR_TTL = 5 * 60; // 5 minutes

// ─── List ─────────────────────────────────────────────────────────────────────

export async function listStudentsWithQr(schoolId, query) {
  const { search, filter, page, limit } = query;
  const skip = (page - 1) * limit;

  const { students, total } = await repo.findStudentsWithQrStatus({
    schoolId,
    search,
    filter,
    skip,
    take: limit,
  });

  return {
    students,
    meta: buildOffsetMeta(total, page, limit),
  };
}

// ─── Single student QR ───────────────────────────────────────────────────────

export async function getStudentQr(studentId, schoolId) {
  return cacheAside(STUDENT_QR_KEY(studentId), STUDENT_QR_TTL, () =>
    repo.findStudentQrDetail(studentId, schoolId),
  );
}

// ─── Assign token ─────────────────────────────────────────────────────────────

export async function assignToken(schoolId, studentId, tokenId) {
  const result = await repo.assignTokenToStudent({
    schoolId,
    studentId,
    tokenId,
  });

  // Invalidate caches — token stats and student QR detail are now stale
  await Promise.all([
    cacheDel(STUDENT_QR_KEY(studentId)),
    invalidateTokenStats(schoolId),
  ]);

  return result;
}

// ─── Exported invalidator (called from token revoke etc.) ────────────────────

export async function invalidateStudentQrCache(studentId) {
  await cacheDel(STUDENT_QR_KEY(studentId));
}
