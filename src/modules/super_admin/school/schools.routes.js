// =============================================================================
// schools.routes.js — RESQID Super Admin Schools
// Routes for school management
// =============================================================================

import { Router } from 'express';
import {
  listSchools,
  getSchoolById,
  toggleSchoolStatus,
  getSchoolsStats,
  getCities,
  registerSchool,
} from './schools.controller.js';

const router = Router();

router.post('/', registerSchool);
router.get('/', listSchools);
router.get('/stats', getSchoolsStats);
router.get('/cities', getCities);
router.get('/:id', getSchoolById);
router.patch('/:id/toggle-status', toggleSchoolStatus);

export default router;
