// =============================================================================
// integration.routes.js — RESQID Orchestrator Routes
// =============================================================================

import { Router } from "express";
import { authenticate } from "../../middleware/auth.middleware.js";
import { rbac } from "../../middleware/rbac.middleware.js";
import { asyncHandler } from "../../utils/response/asyncHandler.js";
import { ApiResponse } from "../../utils/response/ApiResponse.js";

import {
  startOrderOrchestration,
  approveOrderOrchestration,
  cancelOrderOrchestration,
  getOrderStatusOrchestration,
  resumeStalledPipelineOrchestration,
  retryFailedStepOrchestration,
} from "./orchestrator.service.js";

import { handleWebhookEvent } from "./events/event.consumer.js";
import { getQueueHealth } from "./queues/queue.manager.js";
import { getAllWorkers } from "./workers/index.js";

const router = Router();

// Role shortcuts
const superAdmin = rbac(["SUPER_ADMIN"]);
const schoolAdmin = rbac(["SCHOOL_ADMIN", "SUPER_ADMIN"]);

// =============================================================================
// ORDER ORCHESTRATION
// =============================================================================

/**
 * Start order orchestration
 * Called after order creation
 */
router.post(
  "/orders/:orderId/orchestrate",
  authenticate,
  schoolAdmin,
  asyncHandler(async (req, res) => {
    const result = await startOrderOrchestration(
      req.params.orderId,
      {
        id: req.user.id,
        role: req.user.role,
        schoolId: req.user.schoolId,
      },
      { notes: req.body.notes },
    );
    res.json(new ApiResponse(200, result, "Orchestration started"));
  }),
);

/**
 * Approve order (super admin only)
 */
router.post(
  "/orders/:orderId/approve",
  authenticate,
  superAdmin,
  asyncHandler(async (req, res) => {
    const result = await approveOrderOrchestration(
      req.params.orderId,
      { id: req.user.id, role: req.user.role },
      { notes: req.body.notes, metadata: req.body.metadata },
    );
    res.json(new ApiResponse(200, result, "Order approved"));
  }),
);

/**
 * Cancel order (super admin only)
 */
router.post(
  "/orders/:orderId/cancel",
  authenticate,
  superAdmin,
  asyncHandler(async (req, res) => {
    const result = await cancelOrderOrchestration(
      req.params.orderId,
      { id: req.user.id, role: req.user.role },
      { reason: req.body.reason, notes: req.body.notes },
    );
    res.json(new ApiResponse(200, result, "Order cancelled"));
  }),
);

/**
 * Get order status with pipeline progress
 */
router.get(
  "/orders/:orderId/status",
  authenticate,
  asyncHandler(async (req, res) => {
    const status = await getOrderStatusOrchestration(req.params.orderId);
    if (!status.orderId) {
      return res
        .status(404)
        .json(new ApiResponse(404, null, "Order not found"));
    }
    res.json(new ApiResponse(200, status, "Order status retrieved"));
  }),
);

// =============================================================================
// RECOVERY & MAINTENANCE (Super Admin Only)
// =============================================================================

/**
 * Resume stalled pipeline
 */
router.post(
  "/orders/:orderId/resume",
  authenticate,
  superAdmin,
  asyncHandler(async (req, res) => {
    const result = await resumeStalledPipelineOrchestration(req.params.orderId);
    res.json(
      new ApiResponse(
        200,
        result,
        result.success ? "Pipeline resumed" : "Pipeline not stalled",
      ),
    );
  }),
);

/**
 * Retry failed step
 */
router.post(
  "/orders/:orderId/steps/:step/retry",
  authenticate,
  superAdmin,
  asyncHandler(async (req, res) => {
    const result = await retryFailedStepOrchestration(
      req.params.orderId,
      req.params.step,
      { id: req.user.id, role: req.user.role },
      { notes: req.body.notes },
    );
    res.json(new ApiResponse(200, result, "Step retry queued"));
  }),
);

// =============================================================================
// WEBHOOKS (No auth — signature verification happens inside)
// =============================================================================

/**
 * Razorpay webhook
 */
router.post(
  "/webhooks/razorpay",
  asyncHandler(async (req, res) => {
    const { event, payload } = req.body;
    const idempotencyKey =
      req.headers["x-razorpay-signature"] || `${event}:${Date.now()}`;

    await handleWebhookEvent("razorpay", event, payload, idempotencyKey);
    res.json(new ApiResponse(200, { received: true }, "Webhook processed"));
  }),
);

/**
 * Shiprocket webhook
 */
router.post(
  "/webhooks/shiprocket",
  asyncHandler(async (req, res) => {
    const { event, data } = req.body;
    const idempotencyKey =
      req.headers["x-shiprocket-signature"] || `${event}:${Date.now()}`;

    await handleWebhookEvent("shiprocket", event, data, idempotencyKey);
    res.json(new ApiResponse(200, { received: true }, "Webhook processed"));
  }),
);

// =============================================================================
// HEALTH & MONITORING
// =============================================================================

/**
 * Queue health
 */
router.get(
  "/health/queues",
  authenticate,
  superAdmin,
  asyncHandler(async (req, res) => {
    const health = await getQueueHealth();
    res.json(new ApiResponse(200, health, "Queue health retrieved"));
  }),
);

/**
 * Worker status
 */
router.get(
  "/health/workers",
  authenticate,
  superAdmin,
  asyncHandler(async (req, res) => {
    const workers = getAllWorkers();
    const workerStatus = {};
    for (const [name, worker] of workers) {
      workerStatus[name] = {
        isRunning: !worker.isPaused(),
        concurrency: worker.concurrency,
      };
    }
    res.json(new ApiResponse(200, workerStatus, "Worker status retrieved"));
  }),
);

/**
 * Simple health check (public)
 */
router.get(
  "/health",
  asyncHandler(async (req, res) => {
    res.json(
      new ApiResponse(
        200,
        { status: "healthy", timestamp: new Date().toISOString() },
        "OK",
      ),
    );
  }),
);

export default router;
