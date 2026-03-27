// =============================================================================
// modules/school_admin/tokens/tokens.route.js — RESQID
// Mounted at: /api/school-admin
// Full path:  GET /api/school-admin/:schoolId/tokens
//
// ⚠️  Token GENERATION is super admin only — not here.
//     See modules/super_admin/tokens/ for batch generation endpoints.
// =============================================================================

import { Router } from 'express';
import { authenticate, requireSchoolUser } from '#middleware/auth.middleware.js';
import { validateListTokens } from './token.validation.js';
import { listTokens } from './token.controller.js';

const router = Router();

router.get('/:schoolId/tokens', authenticate, requireSchoolUser, validateListTokens, listTokens);

export default router;
