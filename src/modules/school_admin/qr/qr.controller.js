// =============================================================================
// modules/school_admin/qr/qr.controller.js — RESQID
// =============================================================================

import { listStudentsWithQr, getStudentQr, assignToken } from "./qr.service.js";
import { logger } from "../../../config/logger.js";

/**
 * GET /api/school-admin/:schoolId/qr
 * List students with QR status for left panel.
 * Query: search, filter (all|ready|no_token), page, limit
 */
export async function listQr(req, res) {
  const { schoolId } = req.validatedParams;

  try {
    const result = await listStudentsWithQr(schoolId, req.validatedQuery);
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    logger.error({ schoolId, err: err.message }, "QR list fetch failed");
    return res.status(500).json({
      success: false,
      code: "INTERNAL_ERROR",
      message: "Failed to fetch students",
    });
  }
}

/**
 * GET /api/school-admin/:schoolId/qr/:studentId
 * Full QR detail for right panel — called on student click.
 * Returns: student info + token + qr_asset (with public_url for download)
 */
export async function getQrDetail(req, res) {
  const { schoolId, studentId } = req.validatedParams;

  try {
    const student = await getStudentQr(studentId, schoolId);

    if (!student) {
      return res.status(404).json({
        success: false,
        code: "NOT_FOUND",
        message: "Student not found",
      });
    }

    return res.status(200).json({ success: true, data: student });
  } catch (err) {
    logger.error(
      { schoolId, studentId, err: err.message },
      "QR detail fetch failed",
    );
    return res.status(500).json({
      success: false,
      code: "INTERNAL_ERROR",
      message: "Failed to fetch QR detail",
    });
  }
}

/**
 * POST /api/school-admin/:schoolId/qr/:studentId/assign
 * Assign an unassigned token to a student.
 * Body: { token_id }
 *
 * Business rules enforced in repository transaction:
 *   - Token must be UNASSIGNED and belong to this school
 *   - Student must be active and have no current active/issued token
 *   - All-or-nothing — partial assignment impossible
 */
export async function assignTokenToStudent(req, res) {
  const { schoolId, studentId } = req.validatedParams;
  const { token_id } = req.validatedBody;

  try {
    const result = await assignToken(schoolId, studentId, token_id);
    return res.status(200).json({
      success: true,
      message: "Token assigned successfully",
      data: result,
    });
  } catch (err) {
    // Business rule violations from transaction — return correct HTTP status
    if (err.statusCode) {
      return res.status(err.statusCode).json({
        success: false,
        code: err.code,
        message: err.message,
      });
    }

    logger.error(
      { schoolId, studentId, token_id, err: err.message },
      "Token assign failed",
    );
    return res.status(500).json({
      success: false,
      code: "INTERNAL_ERROR",
      message: "Failed to assign token",
    });
  }
}
