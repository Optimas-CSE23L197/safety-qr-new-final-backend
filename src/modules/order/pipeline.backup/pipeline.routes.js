// =============================================================================
// pipeline.routes.js — RESQID
// Pipeline observability endpoints.
// All routes require authentication. Super-admin-only routes are marked.
// =============================================================================

import { Router } from "express";
import { validate } from "../../../middleware/validate.middleware.js";
import { authenticate } from "../../../middleware/auth.middleware.js";
import { requireSuperAdmin } from "../../../middleware/rbac.middleware.js";
import { z } from "zod";

import {
  getPipelineStatus,
  getOrderProgress,
  streamOrderProgress,
  retryStep,
  getOrderJobs,
  getQueueHealthEndpoint,
} from "./pipeline.controller.js";

const router = Router();

router.use(authenticate);

// ── Per-order pipeline endpoints ──────────────────────────────────────────────

// Full pipeline state — super admin only (contains internal job details)
router.get("/:id/pipeline-status", requireSuperAdmin, getPipelineStatus);

// Lightweight progress poll — both school admin and super admin
// School admin sees: pct, step, status
// Super admin sees: all fields including job detail and stall state
router.get("/:id/progress", getOrderProgress);

// SSE stream — super admin only (holds connection open)
router.get("/:id/progress/stream", requireSuperAdmin, streamOrderProgress);

// All jobs for an order — super admin only
router.get("/:id/jobs", requireSuperAdmin, getOrderJobs);

// Retry a failed step
router.post(
  "/:id/retry-step",
  requireSuperAdmin,
  validate(
    z.object({
      params: z.object({ id: z.string().uuid() }),
      body: z
        .object({
          step: z.enum(["TOKEN_GENERATION", "CARD_DESIGN"]),
        })
        .strict(),
    }),
  ),
  retryStep,
);

// ── Global queue health ───────────────────────────────────────────────────────

router.get(
  "/dashboard/queue-health",
  requireSuperAdmin,
  getQueueHealthEndpoint,
);

export default router;
