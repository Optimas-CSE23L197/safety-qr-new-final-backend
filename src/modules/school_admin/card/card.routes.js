// =============================================================================
// modules/school_admin/card_requests/cardRequests.route.js — RESQID
// Mounted at: /api/school-admin
// Full paths:
//   GET  /api/school-admin/:schoolId/card-requests
//   POST /api/school-admin/:schoolId/card-requests
// =============================================================================

import { Router } from 'express';
import { authenticate, requireSchoolUser } from '#middleware/auth.middleware.js';
import { validateListCardRequests, validateCreateCardRequest } from './card.validation.js';
import { getCardRequests, createCardRequest } from './card.controller.js';

const router = Router();

router.get(
  '/:schoolId/card-requests',
  authenticate,
  requireSchoolUser,
  validateListCardRequests,
  getCardRequests
);

router.post(
  '/:schoolId/card-requests',
  authenticate,
  requireSchoolUser,
  validateCreateCardRequest,
  createCardRequest
);

export default router;
