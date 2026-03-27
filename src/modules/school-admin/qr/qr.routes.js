// =============================================================================
// modules/school_admin/qr/qr.route.js — RESQID
// Mounted at: /api/school-admin
// Full paths:
//   GET  /api/school-admin/:schoolId/qr                        — student list
//   GET  /api/school-admin/:schoolId/qr/:studentId             — QR detail
//   POST /api/school-admin/:schoolId/qr/:studentId/assign      — assign token
// =============================================================================

import { Router } from 'express';
import { authenticate, requireSchoolUser } from '#middleware/auth/auth.middleware.js';
import { validateListQr, validateGetStudentQr, validateAssignToken } from './qr.validation.js';
import { listQr, getQrDetail, assignTokenToStudent } from './qr.controller.js';

const router = Router();

// List students with QR status
router.get('/:schoolId/qr', authenticate, requireSchoolUser, validateListQr, listQr);

// Single student QR detail
router.get(
  '/:schoolId/qr/:studentId',
  authenticate,
  requireSchoolUser,
  validateGetStudentQr,
  getQrDetail
);

// Assign unassigned token to student
router.post(
  '/:schoolId/qr/:studentId/assign',
  authenticate,
  requireSchoolUser,
  validateAssignToken,
  assignTokenToStudent
);

export default router;
