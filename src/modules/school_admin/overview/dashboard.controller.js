// =============================================================================
// modules/dashboard/dashboard.controller.js — RESQID
// Responsibility: HTTP in → call service → HTTP out. Nothing else.
// =============================================================================

import { getDashboardData } from "./dashboard.service.js";
import { logger } from "../../../config/logger.js";

/**
 * GET /api/school/:schoolId/dashboard
 *
 * Response shape (maps 1:1 to SchoolAdminDashboard.jsx destructuring):
 * {
 *   success: true,
 *   data: {
 *     stats:           { totalStudents, newStudentsThisMonth, activeTokens,
 *                        totalTokens, expiringTokens, todayScans,
 *                        scanTrendUp, scanChangePercent }
 *     scanTrend:       [{ date, success, failed }]        ← 7 days
 *     tokenBreakdown:  [{ status, count }]                ← donut chart
 *     recentAnomalies: [{ id, type, student_name, severity, created_at }]
 *     pendingRequests: [{ id, type, student_name, parent_name, created_at }]
 *     subscription:    { status, plan, current_period_end, trial_ends_at }
 *   }
 * }
 */
export async function getDashboard(req, res) {
  const { schoolId } = req.validatedParams;

  try {
    const data = await getDashboardData(schoolId);
    return res.status(200).json({ success: true, data });
  } catch (err) {
    logger.error(
      { schoolId, err: err.message, stack: err.stack },
      "Dashboard fetch failed",
    );
    return res.status(500).json({
      success: false,
      code: "INTERNAL_ERROR",
      message: "Failed to load dashboard data",
    });
  }
}
