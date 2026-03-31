// =============================================================================
// routes/index.js — RESQID
// Central router — all /api/* routes registered here
// =============================================================================

import { Router } from 'express';

import authRoute from '#modules/auth/auth.routes.js';

const router = Router();

router.use('/auth', authRoute);
// router.use("/orders", orderRoutes);
// router.use("/school-admin", schoolAdminRouter);
// router.use("/parents", parentRoutes);
// router.use("/super-admin", superAdminRouter);

export default router;
