// =============================================================================
// modules/school_admin/card_requests/cardRequests.controller.js — RESQID
// =============================================================================

import { listCardRequests, submitCardRequest } from './card.service.js';
import { logger } from '#config/logger.js';

/**
 * GET /api/school-admin/:schoolId/card-requests
 * Query: status, search, page, limit
 */
export async function getCardRequests(req, res) {
  const { schoolId } = req.validatedParams;

  try {
    const result = await listCardRequests(schoolId, req.validatedQuery);
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    logger.error({ schoolId, err: err.message }, 'Card requests list failed');
    return res.status(500).json({
      success: false,
      code: 'INTERNAL_ERROR',
      message: 'Failed to fetch card requests',
    });
  }
}

/**
 * POST /api/school-admin/:schoolId/card-requests
 * Body: card_count, notes, delivery_* fields, order_type
 *
 * SECURITY: school_id always comes from req.user (JWT) — never from body
 * This prevents a school from submitting orders on behalf of another school
 */
export async function createCardRequest(req, res) {
  const { schoolId } = req.validatedParams;
  const schoolUserId = req.userId; // from authenticate middleware

  try {
    const order = await submitCardRequest(schoolId, schoolUserId, req.validatedBody);
    return res.status(201).json({
      success: true,
      message: 'Card request submitted successfully',
      data: order,
    });
  } catch (err) {
    logger.error({ schoolId, err: err.message }, 'Card request creation failed');
    return res.status(500).json({
      success: false,
      code: 'INTERNAL_ERROR',
      message: 'Failed to submit card request',
    });
  }
}
