// =============================================================================
// modules/school_admin/students/students.service.js — RESQID
// Responsibility: orchestration only. No Prisma. No caching (list pages are
// dynamic — search/filter/sort combinations make caching impractical).
// =============================================================================

import * as repo from './students.repository.js';
import { buildOffsetMeta } from '#utils/response/paginate.js';

/**
 * getStudentList(schoolId, query)
 * Delegates to repository for DB queries.
 * Builds pagination meta from results.
 */
export async function getStudentList(schoolId, query) {
  const { page, limit, search, class: cls, section, token_status, sort_field, sort_dir } = query;
  const skip = (page - 1) * limit;

  const { students, total } = await repo.findStudents({
    schoolId,
    skip,
    take: limit,
    search,
    class: cls,
    section,
    tokenStatus: token_status,
    sortField: sort_field,
    sortDir: sort_dir,
  });

  return {
    students,
    meta: buildOffsetMeta(total, page, limit),
  };
}
