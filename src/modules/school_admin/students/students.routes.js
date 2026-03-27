// =============================================================================
// modules/school_admin/students/students.route.js — RESQID
// Mounted at: /api/v1/school-admin
// Full path:  GET /api/v1/school-admin/:schoolId/students
// =============================================================================

import { Router } from 'express';
import { authenticate, requireSchoolUser } from '#middleware/auth.middleware.js';
import { validateStudentsQuery } from './students.validation.js';
import { listStudents } from './students.controller.js';

const router = Router();

router.get(
  '/:schoolId/students',
  authenticate, // verify JWT → attach req.user, req.role
  requireSchoolUser, // must be SCHOOL_USER
  validateStudentsQuery, // validate + sanitize all query params + tenant check
  listStudents // handle
);

export default router;
