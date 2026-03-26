// =============================================================================
// routes/index.js — RESQID
// Central router — all /api/* routes registered here
//
// attackLogger is NOT here — it lives in app.js at [15b] (between sanitizeDeep
// and sanitizeXss) so it sees the raw body before script tags are stripped.
//
// server.js → app.js → routes/index.js (/api/path) → /sub-path
// =============================================================================

import { Router } from "express";

// ── Module routers ────────────────────────────────────────────────────────────
import authRoute from "../modules/auth/auth.routes.js";
import orderRoutes from "../modules/order/order.routes.js";

// parent route
import parentRoutes from "../modules/parents/parent.routes.js";

// ── School admin sub-router ───────────────────────────────────────────────────
import schoolAdminRouter from "./schoolAdmin.routes.js";

// ── Super admin sub-router (future) ──────────────────────────────────────────
// import superAdminRouter from "./superAdmin.routes.js";

// ── Parent sub-router (future) ────────────────────────────────────────────────
// import parentRouter from "./parent.routes.js";

const router = Router();

router.use("/auth", authRoute);
router.use("/orders", orderRoutes);
router.use("/school-admin", schoolAdminRouter);
router.use("/parents", parentRoutes);

// router.use("/super-admin",  superAdminRouter);
// router.use("/parents",      parentRouter);

export default router;
