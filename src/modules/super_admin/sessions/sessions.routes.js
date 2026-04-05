// =============================================================================
// sessions.routes.js — RESQID Super Admin Sessions
// Routes for session management
// =============================================================================

import { Router } from 'express';
import {
  listSessions,
  revokeSession,
  revokeAllSessions,
  getSessionStats,
} from './sessions.controller.js';

const router = Router();

router.get('/', listSessions);
router.get('/stats', getSessionStats);
router.post('/revoke-all', revokeAllSessions);
router.delete('/:id/revoke', revokeSession);

export default router;
