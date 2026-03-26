// =============================================================================
// pipeline.controller.js — RESQID
// Endpoints for pipeline observability.
//
//  GET  /api/orders/:id/pipeline-status   — full pipeline state (super admin)
//  GET  /api/orders/:id/progress          — lightweight poll (school admin + super admin)
//  GET  /api/orders/:id/progress/stream   — SSE stream (super admin only)
//  POST /api/orders/:id/retry-step        — retry a failed step
//  GET  /api/orders/:id/jobs              — all job executions for this order
//  GET  /api/orders/dashboard/queue-health — queue health (super admin)
// =============================================================================

import { Redis } from "ioredis";
import { asyncHandler } from "../../../utils/response/asyncHandler.js";
import { ApiResponse } from "../../../utils/response/ApiResponse.js";
import { ApiError } from "../../../utils/response/ApiError.js";
import * as pipelineRepo from "./pipeline.repository.js";
import * as retryService from "./pipeline.retry.js";
import { getQueueHealth } from "../../../services/jobs/queue.service.js";
import { redis } from "../../../config/redis.js";

// Separate subscriber connection — ioredis requires a dedicated connection for SUBSCRIBE
const subscriber = new Redis(process.env.REDIS_URL);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/orders/:id/pipeline-status
// Full pipeline state for super admin — includes all step executions and jobs
// ─────────────────────────────────────────────────────────────────────────────

export const getPipelineStatus = asyncHandler(async (req, res) => {
  const pipeline = await pipelineRepo.findPipelineByOrderId(req.params.id);

  if (!pipeline) {
    return ApiResponse.ok({
      pipeline: null,
      message: "Pipeline not yet created for this order",
    }).send(res);
  }

  // Compute per-step summary
  const stepSummary = buildStepSummary(pipeline.steps);

  return ApiResponse.ok(
    {
      pipeline: {
        id: pipeline.id,
        orderId: pipeline.order_id,
        currentStep: pipeline.current_step,
        overallProgress: pipeline.overall_progress,
        isStalled: pipeline.is_stalled,
        stalledAt: pipeline.stalled_at,
        stalledReason: pipeline.stalled_reason,
        startedAt: pipeline.started_at,
        completedAt: pipeline.completed_at,
      },
      steps: stepSummary,
      rawSteps: pipeline.steps, // full detail for super admin
    },
    "Pipeline status fetched",
  ).send(res);
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/orders/:id/progress
// Lightweight poll — safe for school admin too (internal fields stripped)
// Returns in <10ms from Redis cache when possible.
// ─────────────────────────────────────────────────────────────────────────────

export const getOrderProgress = asyncHandler(async (req, res) => {
  const isSuperAdmin = req.user.role === "SUPER_ADMIN";
  const orderId = req.params.id;

  // Try Redis cache first (worker publishes here on every chunk)
  const cached = await redis.get(`pipeline:${orderId}:latest`);
  if (cached) {
    const data = JSON.parse(cached);
    if (!isSuperAdmin) {
      // Strip internal fields for school admins
      const { pct, step, status } = data;
      return ApiResponse.ok({ pct, step, status }, "Progress").send(res);
    }
    return ApiResponse.ok(data, "Progress").send(res);
  }

  // Fall back to DB
  const pipeline = await pipelineRepo.findPipelineByOrderIdLight(orderId);
  if (!pipeline)
    return ApiResponse.ok(
      { pct: 0, step: "CREATE", status: "PENDING" },
      "Progress",
    ).send(res);

  const latestStep = getLatestActiveStep(pipeline.steps);

  const response = {
    pct: pipeline.overall_progress,
    step: pipeline.current_step,
    status: latestStep?.status ?? "PENDING",
    stepProgress: latestStep?.progress ?? 0,
    ...(isSuperAdmin
      ? {
          stepDetail: latestStep?.progress_detail,
          isStalled: pipeline.is_stalled,
          stalledAt: pipeline.stalled_at,
        }
      : {}),
  };

  return ApiResponse.ok(response, "Progress").send(res);
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/orders/:id/progress/stream
// SSE — real-time progress push to super admin dashboard.
// Client connects once, stays open, receives events as worker progresses.
// ─────────────────────────────────────────────────────────────────────────────

export const streamOrderProgress = asyncHandler(async (req, res) => {
  const orderId = req.params.id;
  const channel = `pipeline:${orderId}:progress`;

  // SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // disable Nginx buffering
  res.flushHeaders();

  const sendEvent = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // Send initial state
  const pipeline = await pipelineRepo.findPipelineByOrderIdLight(orderId);
  sendEvent("connected", {
    orderId,
    pipeline: pipeline ?? null,
    ts: Date.now(),
  });

  // Subscribe to Redis channel
  const sub = subscriber.duplicate();
  await sub.subscribe(channel);

  sub.on("message", (ch, message) => {
    if (ch !== channel) return;
    try {
      const data = JSON.parse(message);
      sendEvent("progress", data);

      // Cache the latest progress snapshot for polling fallback
      redis.setex(`pipeline:${orderId}:latest`, 300, message).catch(() => {});

      // Send completion/failure event then close
      if (data.status === "COMPLETED" || data.status === "FAILED") {
        sendEvent("done", { orderId, status: data.status });
        cleanup();
      }
    } catch (_) {}
  });

  // Heartbeat every 15s to keep the connection alive through load balancers
  const heartbeat = setInterval(() => {
    res.write(": heartbeat\n\n");
  }, 15000);

  // Clean up on client disconnect
  const cleanup = () => {
    clearInterval(heartbeat);
    sub.unsubscribe(channel).catch(() => {});
    sub.quit().catch(() => {});
    if (!res.writableEnded) res.end();
  };

  req.on("close", cleanup);
  req.on("error", cleanup);

  // Auto-close after 10 minutes — client should reconnect if needed
  setTimeout(cleanup, 10 * 60 * 1000);
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/orders/:id/retry-step
// Retry a FAILED or PARTIAL_FAILED step
// Body: { step: "TOKEN_GENERATION" }
// ─────────────────────────────────────────────────────────────────────────────

export const retryStep = asyncHandler(async (req, res) => {
  const { step } = req.body;
  if (!step) throw ApiError.badRequest("step is required");

  const result = await retryService.retryPipelineStep({
    orderId: req.params.id,
    step,
    adminId: req.user.id,
    ip: req.ip,
  });

  return ApiResponse.ok(result, `Step ${step} retry queued`).send(res);
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/orders/:id/jobs
// All job executions for an order — for the job history panel
// ─────────────────────────────────────────────────────────────────────────────

export const getOrderJobs = asyncHandler(async (req, res) => {
  const pipeline = await pipelineRepo.findPipelineByOrderId(req.params.id);
  if (!pipeline) return ApiResponse.ok({ jobs: [] }, "No jobs").send(res);

  const allJobs = pipeline.steps.flatMap((s) =>
    s.jobs.map((j) => ({
      ...j,
      stepName: s.step,
      stepAttempt: s.attempt_number,
    })),
  );

  return ApiResponse.ok({ jobs: allJobs }, "Jobs fetched").send(res);
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/orders/dashboard/queue-health
// BullMQ queue health — super admin only
// ─────────────────────────────────────────────────────────────────────────────

export const getQueueHealthEndpoint = asyncHandler(async (req, res) => {
  const [queueHealth, deadJobs, stalledPipelines] = await Promise.all([
    getQueueHealth(),
    pipelineRepo.findDeadJobs({ limit: 20 }),
    pipelineRepo.findStalledPipelines(),
  ]);

  return ApiResponse.ok(
    { queues: queueHealth, deadJobs, stalledPipelines },
    "Queue health fetched",
  ).send(res);
});

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const getLatestActiveStep = (steps) => {
  if (!steps?.length) return null;
  const running = steps.find((s) => s.status === "RUNNING");
  if (running) return running;
  return steps[steps.length - 1];
};

const buildStepSummary = (steps) => {
  // Group by step name, pick the latest attempt
  const byStep = {};
  for (const step of steps) {
    const existing = byStep[step.step];
    if (!existing || step.attempt_number > existing.attempt_number) {
      byStep[step.step] = step;
    }
  }

  return Object.values(byStep).map((s) => ({
    step: s.step,
    status: s.status,
    progress: s.progress,
    attemptNumber: s.attempt_number,
    startedAt: s.started_at,
    completedAt: s.completed_at,
    durationMs: s.duration_ms,
    resultSummary: s.result_summary,
    hasError: !!s.error_log,
    jobCount: s.jobs?.length ?? 0,
    activeJobs: s.jobs?.filter((j) => j.status === "RUNNING").length ?? 0,
    failedJobs:
      s.jobs?.filter((j) => ["FAILED", "DEAD"].includes(j.status)).length ?? 0,
  }));
};
