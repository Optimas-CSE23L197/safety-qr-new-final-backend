// =============================================================================
// admins.routes.js — RESQID Super Admin Admin Management
// Routes for admin management (SuperAdmins + SchoolAdmins)
// =============================================================================

import { Router } from 'express';
import {
  listAdmins,
  getAdminById,
  toggleAdminStatus,
  resetAdminPassword,
  getAdminsStats,
} from './admins.controller.js';

const router = Router();

router.get('/', listAdmins);
router.get('/stats', getAdminsStats);
router.post('/reset-password', resetAdminPassword);
router.get('/:id', getAdminById);
router.patch('/:id/toggle-status', toggleAdminStatus);

export default router;
