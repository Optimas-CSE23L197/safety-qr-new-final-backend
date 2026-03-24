// =============================================================================
// modules/school_admin/anomalies/anomaly.controller.js — RESQID
// =============================================================================

import { getAnomalyInventory, resolveAnomaly } from "./scanAnomaly.service.js";
import { logger } from "../../../config/logger.js";

/**
 * GET /api/school-admin/:schoolId/anomalies
 *
 * Query params (all optional):
 *   filter  — "UNRESOLVED" (default) | "RESOLVED" | "ALL"
 *   type    — "ALL" (default) | any AnomalyType enum value
 *   page    — positive integer  (default: 1)
 *   limit   — 1–100            (default: 20)
 *
 * Response:
 * {
 *   success: true,
 *   data: {
 *     anomalies: [...],
 *     stats: { unresolved },
 *     meta: { total, page, limit, totalPages, hasNextPage, hasPrevPage }
 *   }
 * }
 */
export async function listAnomalies(req, res) {
  const { schoolId } = req.validatedParams;

  try {
    const result = await getAnomalyInventory(schoolId, req.validatedQuery);
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    logger.error(
      { schoolId, err: err.message },
      "Anomaly inventory fetch failed",
    );
    return res.status(500).json({
      success: false,
      code: "INTERNAL_ERROR",
      message: "Failed to fetch anomalies",
    });
  }
}

/**
 * PATCH /api/school-admin/:schoolId/anomalies/:anomalyId/resolve
 *
 * Body (optional):
 *   { notes: "Confirmed school trip." }
 *
 * Response:
 * {
 *   success: true,
 *   data: { anomaly: { ...resolvedAnomaly } }
 * }
 *
 * Errors:
 *   404 — anomaly not found, already resolved, or belongs to another school
 */
export async function resolveAnomalyHandler(req, res) {
  const { schoolId, anomalyId } = req.validatedParams;
  const { notes } = req.validatedBody;
  const resolvedBy = req.user.id; // set by authenticate middleware

  try {
    const anomaly = await resolveAnomaly({
      anomalyId,
      schoolId,
      resolvedBy,
      notes,
    });

    if (!anomaly) {
      return res.status(404).json({
        success: false,
        code: "NOT_FOUND",
        message: "Anomaly not found or already resolved",
      });
    }

    return res.status(200).json({ success: true, data: { anomaly } });
  } catch (err) {
    logger.error(
      { schoolId, anomalyId, err: err.message },
      "Anomaly resolve failed",
    );
    return res.status(500).json({
      success: false,
      code: "INTERNAL_ERROR",
      message: "Failed to resolve anomaly",
    });
  }
}
