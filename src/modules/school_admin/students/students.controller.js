// =============================================================================
// modules/school_admin/students/students.controller.js — RESQID
// =============================================================================

import { getStudentList } from "./students.service.js";
import { logger } from "../../../config/logger.js";

/**
 * GET /api/v1/school-admin/:schoolId/students
 *
 * Query params (all optional, all validated):
 *   page, limit, search, class, section, token_status, sort_field, sort_dir
 *
 * Response:
 * {
 *   success: true,
 *   data: {
 *     students: [...],
 *     meta: { total, page, limit, totalPages, hasNextPage, hasPrevPage }
 *   }
 * }
 */
export async function listStudents(req, res) {
  const { schoolId } = req.validatedParams;
  const query = req.validatedQuery;

  try {
    const result = await getStudentList(schoolId, query);
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    logger.error(
      { schoolId, query, err: err.message },
      "Students list fetch failed",
    );
    return res.status(500).json({
      success: false,
      code: "INTERNAL_ERROR",
      message: "Failed to fetch students",
    });
  }
}
