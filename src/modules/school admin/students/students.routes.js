// =============================================================================
// students.routes.js — RESQID School Admin › Students
//
// Mount:
//   import studentsRouter from "./school-admin/students/students.routes.js";
//   app.use("/api/v1/school-admin/students", studentsRouter);
//
// Middleware chain: authenticate → requireSchoolUser → can(permission) → validate → ctrl
// =============================================================================

import { Router }                          from "express";
import { authenticate, requireSchoolUser } from "../../../middleware/auth.middleware.js";
import { can }                             from "../../../middleware/rbac.middleware.js";
import { validate, validateAll }           from "../../../middleware/validate.middleware.js";
import * as ctrl                           from "./students.controller.js";
import {
  uuidParam,
  listStudentsSchema,
  createStudentSchema,
  updateStudentSchema,
  listParentRequestsSchema,
  approveRequestSchema,
  rejectRequestSchema,
} from "./students.validation.js";

const router = Router();
router.use(authenticate, requireSchoolUser);

// =============================================================================
// STUDENT CRUD
// =============================================================================

/**
 * GET /api/v1/school-admin/students
 * Paginated list with search + class/section/status filters
 */
router.get(
  "/",
  can("student:read"),
  validate(listStudentsSchema, "query"),
  ctrl.listStudents,
);

/**
 * POST /api/v1/school-admin/students
 * Enroll a new student — returns 201 + student object
 */
router.post(
  "/",
  can("student:create"),
  validate(createStudentSchema, "body"),
  ctrl.createStudent,
);

/**
 * GET /api/v1/school-admin/students/:id
 * Full student profile — tokens, parents, emergency contacts, card visibility
 */
router.get(
  "/:id",
  can("student:read"),
  validate(uuidParam, "params"),
  ctrl.getStudent,
);

/**
 * PATCH /api/v1/school-admin/students/:id
 * Partial update — class, section, photo, setup_stage, is_active etc.
 */
router.patch(
  "/:id",
  can("student:update"),
  validateAll({ params: uuidParam, body: updateStudentSchema }),
  ctrl.updateStudent,
);

/**
 * DELETE /api/v1/school-admin/students/:id
 * Soft delete — blocked if student has ACTIVE token
 */
router.delete(
  "/:id",
  can("student:delete"),
  validate(uuidParam, "params"),
  ctrl.deleteStudent,
);

// =============================================================================
// STUDENT — NESTED RESOURCES
// =============================================================================

/**
 * GET /api/v1/school-admin/students/:id/scan-activity
 * Paginated recent scans for this student
 */
router.get(
  "/:id/scan-activity",
  can("scan_log:read"),
  validate(uuidParam, "params"),
  ctrl.getStudentScanActivity,
);

/**
 * GET /api/v1/school-admin/students/:id/token-card
 * Full ID card data — student + active token + school branding
 */
router.get(
  "/:id/token-card",
  can("student:read"),
  validate(uuidParam, "params"),
  ctrl.getStudentTokenCard,
);

// =============================================================================
// PARENT REQUESTS
// =============================================================================

/**
 * GET /api/v1/school-admin/students/parent-requests
 * All parent edit requests — filter by status (PENDING/APPROVED/REJECTED)
 * NOTE: this route MUST be defined before /:id to avoid param clash
 */
router.get(
  "/parent-requests",
  can("student:read"),
  validate(listParentRequestsSchema, "query"),
  ctrl.listParentRequests,
);

/**
 * GET /api/v1/school-admin/students/parent-requests/pending-count
 * Lightweight count for sidebar badge — Redis cached 20 s
 */
router.get(
  "/parent-requests/pending-count",
  can("student:read"),
  ctrl.getPendingRequestCount,
);

/**
 * PATCH /api/v1/school-admin/students/parent-requests/:id/approve
 * Approve a parent edit request — stamps reviewed_by + reviewed_at
 */
router.patch(
  "/parent-requests/:id/approve",
  can("student:update"),
  validateAll({ params: uuidParam, body: approveRequestSchema }),
  ctrl.approveParentRequest,
);

/**
 * PATCH /api/v1/school-admin/students/parent-requests/:id/reject
 * Reject a parent edit request — requires a rejection reason
 */
router.patch(
  "/parent-requests/:id/reject",
  can("student:update"),
  validateAll({ params: uuidParam, body: rejectRequestSchema }),
  ctrl.rejectParentRequest,
);

export default router;