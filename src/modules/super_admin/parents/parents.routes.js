// =============================================================================
// parents.routes.js — RESQID Super Admin Parents
// Routes for parent management
// =============================================================================

import { Router } from 'express';
import {
  listParents,
  getParentById,
  toggleParentStatus,
  revokeParentDevices,
  getParentsStats,
  getParentFilters,
} from './parents.controller.js';

const router = Router();

router.get('/', listParents);
router.get('/stats', getParentsStats);
router.get('/filters', getParentFilters);
router.get('/:id', getParentById);
router.patch('/:id/toggle-status', toggleParentStatus);
router.post('/:id/revoke-devices', revokeParentDevices);

export default router;
