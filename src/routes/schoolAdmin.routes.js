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

import { Router } from "express";

import dashboardRouter from "../modules/school_admin/overview/dashboard.route.js";
import studentsRouter from "../modules/school_admin/students/students.routes.js";

// future school admin modules — uncomment as you build them:
// import tokensRouter      from "../modules/school_admin/tokens/tokens.route.js";
// import monitoringRouter  from "../modules/school_admin/monitoring/monitoring.route.js";
// import parentReqRouter   from "../modules/school_admin/parents/parentRequests.route.js";
// import anomaliesRouter   from "../modules/school_admin/anomalies/anomalies.route.js";
// import settingsRouter    from "../modules/school_admin/settings/settings.route.js";

const router = Router();

router.use(dashboardRouter);
router.use(studentsRouter);

// router.use(tokensRouter);
// router.use(monitoringRouter);
// router.use(parentReqRouter);
// router.use(anomaliesRouter);
// router.use(settingsRouter);

export default router;
