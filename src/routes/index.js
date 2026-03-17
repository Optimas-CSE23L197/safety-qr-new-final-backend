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

const router = Router();

// ── Routes ────────────────────────────────────────────────────────────────────
import authRoute from "../modules/auth/auth.routes.js";

router.use("/auth", authRoute);

// future routes
// router.use("/school", schoolRoute);
// router.use("/parents", parentsRoute);
// router.use("/super-admin", superRoute);

export default router;
