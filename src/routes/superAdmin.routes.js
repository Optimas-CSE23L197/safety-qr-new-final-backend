// =============================================================================
// routes/superAdmin.routes.js — RESQID
// All super admin module routes in one place.
// Mounted at: /api/super-admin
// =============================================================================
import { Router } from 'express';
import { authenticate } from '#middleware/auth/auth.middleware.js';
import { requireSuperAdmin } from '#middleware/auth/rbac.middleware.js';
import dashboardRoutes from '#modules/super_admin/overview/dashboard.routes.js';
import schoolsRoutes from '#modules/super_admin/school/schools.routes.js';
import adminRoutes from '#modules/super_admin/admin/admins.routes.js';
import studentRoutes from '#modules/super_admin/students/students.routes.js';
import parentRoutes from '#modules/super_admin/parents/parents.routes.js';
import tokenRoutes from '#modules/super_admin/tokens/tokens.routes.js';
import scanRoutes from '#modules/super_admin/scan/scan-logs.routes.js';
import scanAnomaliesRoutes from '#modules/super_admin/scan-anomalies/scan-anomalies.routes.js';
import sessionRoutes from '#modules/super_admin/sessions/sessions.routes.js';
import locationRoutes from '#modules/super_admin/location/location.routes.js';
const router = Router();

router.use(authenticate);
router.use(requireSuperAdmin);

router.use('/dashboard', dashboardRoutes);
router.use('/schools', schoolsRoutes);
router.use('/admins', adminRoutes);
router.use('/students', studentRoutes);
router.use('/parents', parentRoutes);
router.use('/tokens', tokenRoutes);
router.use('/scan-logs', scanRoutes);
router.use('/scan-anomalies', scanAnomaliesRoutes);
router.use('/sessions', sessionRoutes);
router.use('/locations', locationRoutes);

export default router;
