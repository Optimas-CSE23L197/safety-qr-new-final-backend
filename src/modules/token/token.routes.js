// =============================================================================
// token.routes.js — RESQID
// Token generation routes — super admin only
//
// All routes protected by:
//   authenticateSuperAdmin → verifies JWT + session
//   validate(schema)       → zod body validation
//   asyncHandler           → catches thrown errors → globalErrorHandler
//
// Routes:
//   POST /api/tokens/blank/single       → 1 blank token
//   POST /api/tokens/blank/bulk         → N blank tokens
//   POST /api/tokens/preloaded/single   → 1 token linked to student
//   POST /api/tokens/preloaded/bulk     → N tokens linked to students
// =============================================================================

import { Router } from 'express';
import { asyncHandler } from '#shared/response/asyncHandler.js';
import { validate } from '#middleware/validate.middleware.js';
import { authenticateSuperAdmin } from '#middleware/auth/auth.middleware.js';
import {
  generateSingleBlank,
  generateBulkBlank,
  generateSinglePreloaded,
  generateBulkPreloaded,
} from './token.controller.js';
import {
  singleBlankTokenSchema,
  bulkBlankTokensSchema,
  singlePreloadedTokenSchema,
  bulkPreloadedTokensSchema,
} from './token.validation.js';

const router = Router();

// All token generation is super admin only
router.use(authenticateSuperAdmin);

// ── Blank tokens (no student attached) ───────────────────────────────────────
router.post('/blank/single', validate(singleBlankTokenSchema), asyncHandler(generateSingleBlank));
router.post('/blank/bulk', validate(bulkBlankTokensSchema), asyncHandler(generateBulkBlank));

// ── Pre-details tokens (student attached from day 1) ─────────────────────────
router.post(
  '/preloaded/single',
  validate(singlePreloadedTokenSchema),
  asyncHandler(generateSinglePreloaded)
);
router.post(
  '/preloaded/bulk',
  validate(bulkPreloadedTokensSchema),
  asyncHandler(generateBulkPreloaded)
);

export default router;
