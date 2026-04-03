// =============================================================================
// tokens.routes.js — RESQID Super Admin Tokens
// Routes for token management
// =============================================================================

import { Router } from 'express';
import {
  listTokens,
  getTokenById,
  revokeToken,
  replaceToken,
  getTokenStats,
  getTokenBatches,
} from './tokens.controller.js';

const router = Router();

router.get('/', listTokens);
router.get('/stats', getTokenStats);
router.get('/batches', getTokenBatches);
router.get('/:id', getTokenById);
router.post('/:id/revoke', revokeToken);
router.post('/:id/replace', replaceToken);

export default router;
