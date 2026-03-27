// =============================================================================
// modules/school_admin/notifications/notification.routes.js — RESQID
// Mounted at: /api/school-admin
//
// Routes:
//   GET   /api/school-admin/:schoolId/notifications
//   PATCH /api/school-admin/:schoolId/notifications/read-all
//   PATCH /api/school-admin/:schoolId/notifications/:notificationId/read
//
// ⚠️  ORDER MATTERS:
//     "read-all" MUST be registered before "/:notificationId/read"
//     otherwise Express matches "read-all" as a notificationId UUID — which
//     fails UUID validation and returns 400 instead of hitting the right handler.
// =============================================================================

import { Router } from 'express';
import { authenticate, requireSchoolUser } from '#middleware/auth/auth.middleware.js';
import {
  validateListNotifications,
  validateMarkRead,
  validateMarkAllRead,
} from './notification.validation.js';
import {
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from './notification.controller.js';

const router = Router();

// List notifications — paginated, filterable by status / type
router.get(
  '/:schoolId/notifications',
  authenticate,
  requireSchoolUser,
  validateListNotifications,
  listNotifications
);

// ⚠️  read-all BEFORE :notificationId/read — see file header comment
router.patch(
  '/:schoolId/notifications/read-all',
  authenticate,
  requireSchoolUser,
  validateMarkAllRead,
  markAllNotificationsRead
);

// Mark single notification as read
router.patch(
  '/:schoolId/notifications/:notificationId/read',
  authenticate,
  requireSchoolUser,
  validateMarkRead,
  markNotificationRead
);

export default router;
