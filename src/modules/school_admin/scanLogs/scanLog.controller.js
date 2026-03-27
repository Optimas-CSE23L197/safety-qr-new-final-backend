// =============================================================================
// modules/school_admin/scan_logs/scanlog.controller.js — RESQID
// =============================================================================

import { getScanLogInventory } from './scanLog.service.js';
import { logger } from '#config/logger.js';

/**
 * GET /api/school-admin/:schoolId/scan-logs
 *
 * Query params (all optional):
 *   result  — "ALL" | "SUCCESS" | "INVALID" | "REVOKED" | "EXPIRED" |
 *             "INACTIVE" | "RATE_LIMITED" | "ERROR"   (default: "ALL")
 *   search  — student name, ip_city, or token_hash prefix          (max 100)
 *   from    — ISO date string  e.g. "2024-01-01"
 *   to      — ISO date string  e.g. '2024-01-31'
 *   page    — positive integer                                      (default: 1)
 *   limit   — 1–100                                                 (default: 15)
 *
 * Response:
 * {
 *   success: true,
 *   data: {
 *     logs:  [...],
 *     stats: { total, failed, SUCCESS, INVALID, REVOKED, EXPIRED,
 *              INACTIVE, RATE_LIMITED, ERROR, avgResponseMs },
 *     meta:  { total, page, limit, totalPages, hasNextPage, hasPrevPage }
 *   }
 * }
 */
export async function listScanLogs(req, res) {
  const { schoolId } = req.validatedParams;

  try {
    const result = await getScanLogInventory(schoolId, req.validatedQuery);
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    logger.error({ schoolId, err: err.message }, 'Scan log inventory fetch failed');
    return res.status(500).json({
      success: false,
      code: 'INTERNAL_ERROR',
      message: 'Failed to fetch scan logs',
    });
  }
}
