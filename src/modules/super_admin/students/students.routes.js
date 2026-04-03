// =============================================================================
// students.routes.js — RESQID Super Admin Students
// Routes for student management
// =============================================================================

import { Router } from 'express';
import {
  listStudents,
  getStudentById,
  toggleStudentStatus,
  revokeStudentToken,
  resetStudentToken,
  markCardReprint,
  getStudentsStats,
  getStudentFilters,
} from './students.controller.js';

const router = Router();

router.get('/', listStudents);
router.get('/stats', getStudentsStats);
router.get('/filters', getStudentFilters);
router.get('/:id', getStudentById);
router.patch('/:id/toggle-status', toggleStudentStatus);
router.patch('/:id/token/revoke', revokeStudentToken);
router.patch('/:id/token/reset', resetStudentToken);
router.patch('/:id/card/reprint', markCardReprint);

export default router;
