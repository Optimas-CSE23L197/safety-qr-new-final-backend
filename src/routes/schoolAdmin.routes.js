// =============================================================================
// routes/schoolAdmin.routes.js — RESQID
// All school admin module routes in one place.
// Mounted at: /api/school-admin
//
// To add a new school admin page:
//   1. Create modules/school_admin/your_feature/your_feature.route.js
//   2. Import it here and add one line: router.use(yourFeatureRouter)
//   That's it — nothing else to touch.
// =============================================================================

import { Router } from 'express';

import dashboardRouter from '#modules/school_admin/overview/dashboard.route.js';
import studentsRouter from '#modules/school_admin/students/students.routes.js';
import cardRequestsRouter from '#modules/school_admin/card/card.routes.js';
import tokensRouter from '#modules/school_admin/tokens/token.routes.js';
import qrRouter from '#modules/school_admin/qr/qr.routes.js';
import scanLogRouter from '#modules/school_admin/scanLogs/scanLog.routes.js';
import scanAnomalyRouter from '#modules/school_admin/scanAnomaly/scanAnomaly.routes.js';
import notificationRouter from '#modules/school_admin/notification/notification.routes.js';

const router = Router();

router.use(dashboardRouter);
router.use(studentsRouter);
router.use(cardRequestsRouter);
router.use(tokensRouter);
router.use(qrRouter);
router.use(scanLogRouter);
router.use(scanAnomalyRouter);
router.use(notificationRouter);

export default router;
