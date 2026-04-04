// =============================================================================
// routes/index.js — RESQID
// Central router — all /api/* routes registered here
// =============================================================================

import { Router } from 'express';

import authRoute from '#modules/auth/auth.routes.js';
import orderRoute from '#modules/order/order.routes.js';

// ================================================
// Super admin routes
// ================================================
import superAdminRoutes from './superAdmin.routes.js';

const router = Router();

router.use('/auth', authRoute);
router.use('/orders', orderRoute);
// router.use("/orders", orderRoutes);
// router.use("/school-admin", schoolAdminRouter);
// router.use("/parents", parentRoutes);
// router.use("/super-admin", superAdminRouter);

// ================================================
// Super admin routes start
// ================================================
router.use('/super-admin', superAdminRoutes);
// ================================================
// Super admin routes end
// ================================================

export default router;
