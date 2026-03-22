// =============================================================================
// modules/school_admin/tokens/tokens.controller.js — RESQID
// =============================================================================

import { getTokenInventory } from "./token.service.js";
import { logger } from "../../../config/logger.js";

/**
 * GET /api/school-admin/:schoolId/tokens
 *
 * Response:
 * {
 *   success: true,
 *   data: {
 *     tokens: [...],
 *     stats:  { ACTIVE, UNASSIGNED, ISSUED, EXPIRED, REVOKED, INACTIVE, total },
 *     meta:   { total, page, limit, totalPages, hasNextPage, hasPrevPage }
 *   }
 * }
 *
 * NOTE: Token batch generation is a SUPER ADMIN only operation.
 * School admin can VIEW tokens — cannot generate them.
 * The "Generate Batch" button in TokenInventory.jsx is gated by
 * can('tokens.createBatch') which should never be true for SCHOOL_USER role.
 */
export async function listTokens(req, res) {
  const { schoolId } = req.validatedParams;

  try {
    const result = await getTokenInventory(schoolId, req.validatedQuery);
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    logger.error(
      { schoolId, err: err.message },
      "Token inventory fetch failed",
    );
    return res.status(500).json({
      success: false,
      code: "INTERNAL_ERROR",
      message: "Failed to fetch token inventory",
    });
  }
}
