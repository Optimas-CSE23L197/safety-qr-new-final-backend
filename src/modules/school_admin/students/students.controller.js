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

/**
 * GET /api/v1/school-admin/:schoolId/students/:studentId
 * Get complete student details for school admin view
 */
export async function getStudentDetails(req, res) {
  const { schoolId, studentId } = req.validatedParams;

  try {
    const student = await getStudentById(schoolId, studentId);
    if (!student) {
      return res.status(404).json({
        success: false,
        code: "NOT_FOUND",
        message: "Student not found in this school",
      });
    }
    return res.status(200).json({ success: true, data: student });
  } catch (err) {
    logger.error(
      { schoolId, studentId, err: err.message },
      "Student details fetch failed",
    );
    return res.status(500).json({
      success: false,
      code: "INTERNAL_ERROR",
      message: "Failed to fetch student details",
    });
  }
}
