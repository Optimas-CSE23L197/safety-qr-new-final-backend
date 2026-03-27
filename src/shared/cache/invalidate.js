// =============================================================================
// invalidate.js — RESQID
// Targeted cache invalidation — call these whenever data changes in DB
// Every entity has its own invalidator — no manual key management in services
//
// Rule: any time you UPDATE a DB record, call the matching invalidator
// =============================================================================

import { cacheDel, cacheDelPattern, CacheKey } from './cache.js';

// ─── School ───────────────────────────────────────────────────────────────────

export async function invalidateSchool(schoolId) {
  await cacheDel(CacheKey.school(schoolId), CacheKey.schoolSettings(schoolId));
}

// ─── Session ──────────────────────────────────────────────────────────────────

export async function invalidateSession(sessionId) {
  await cacheDel(CacheKey.session(sessionId));
}

export async function invalidateAllParentSessions(parentId) {
  // Pattern-based — clears all session:* keys for this parent
  // Also clear parent profile cache
  await Promise.all([
    cacheDelPattern(`session:*`), // broad — sessions don't carry parentId in key
    cacheDel(CacheKey.parentProfile(parentId)),
  ]);
  // Note: Targeted session invalidation in auth.service.js handles DB-side
}

// ─── Parent ───────────────────────────────────────────────────────────────────

export async function invalidateParent(parentId) {
  await cacheDel(CacheKey.parentProfile(parentId), CacheKey.parentChildren(parentId));
}

export async function invalidateParentChildren(parentId) {
  await cacheDel(CacheKey.parentChildren(parentId));
}

// ─── Token / Emergency Page ───────────────────────────────────────────────────

export async function invalidateToken(tokenHash) {
  await cacheDel(CacheKey.tokenStatus(tokenHash), CacheKey.emergencyPage(tokenHash));
}

/**
 * invalidateEmergencyPage(tokenHash)
 * Call this whenever:
 *   - Parent updates emergency profile
 *   - Parent updates emergency contacts
 *   - Parent changes card visibility
 *   - Student photo/name updated
 */
export async function invalidateEmergencyPage(tokenHash) {
  await cacheDel(CacheKey.emergencyPage(tokenHash));
}

/**
 * invalidateAllStudentEmergencyPages(studentId, prisma)
 * When student data changes, invalidate ALL their token emergency pages
 */
export async function invalidateAllStudentEmergencyPages(studentId, prisma) {
  const tokens = await prisma.token.findMany({
    where: { student_id: studentId, status: { in: ['ACTIVE', 'ISSUED'] } },
    select: { token_hash: true },
  });

  const keys = tokens.map(t => CacheKey.emergencyPage(t.token_hash));
  if (keys.length) await cacheDel(...keys);
}

// ─── Blacklist ────────────────────────────────────────────────────────────────

export async function addToBlacklist(tokenHash, ttlSeconds) {
  const { cacheSet } = await import('./cache.js');
  await cacheSet(CacheKey.blacklist(tokenHash), 1, ttlSeconds);
}
