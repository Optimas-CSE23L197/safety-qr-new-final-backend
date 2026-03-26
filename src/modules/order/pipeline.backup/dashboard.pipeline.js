// =============================================================================
// dashboard.pipeline.js — RESQID
// Builds the complete data structure for the Super Admin Pipeline Dashboard.
//
// The frontend renders this directly — no additional client-side assembly needed.
// All heavy DB queries are combined into the minimum number of round-trips.
// =============================================================================

import { prisma } from "../../../config/prisma.js";
import * as pipelineRepo from "./pipeline.repository.js";
import { getQueueHealth } from "../../../services/jobs/queue.service.js";

// Step display order — defines the visual pipeline timeline
const STEP_ORDER = [
  "CREATE",
  "CONFIRM",
  "ADVANCE_INVOICE",
  "ADVANCE_PAYMENT",
  "TOKEN_GENERATION",
  "CARD_DESIGN",
  "VENDOR_DISPATCH",
  "PRINTING_START",
  "PRINTING_DONE",
  "SHIPMENT_CREATE",
  "SHIPMENT_SHIPPED",
  "DELIVERY",
  "BALANCE_INVOICE",
  "BALANCE_PAYMENT",
];

// Human-readable labels for each step
const STEP_LABELS = {
  CREATE: "Order created",
  CONFIRM: "Confirmed",
  ADVANCE_INVOICE: "Advance invoice",
  ADVANCE_PAYMENT: "Advance received",
  TOKEN_GENERATION: "Token & QR generation",
  CARD_DESIGN: "Card design",
  VENDOR_DISPATCH: "Sent to vendor",
  PRINTING_START: "Printing started",
  PRINTING_DONE: "Print complete",
  SHIPMENT_CREATE: "Shipment created",
  SHIPMENT_SHIPPED: "Shipped",
  DELIVERY: "Delivered",
  BALANCE_INVOICE: "Balance invoice",
  BALANCE_PAYMENT: "Payment complete",
};

// Which steps are async (worker-driven) vs synchronous (HTTP)
const ASYNC_STEPS = new Set(["TOKEN_GENERATION", "CARD_DESIGN"]);

/**
 * Build the full dashboard payload for a single order's pipeline page.
 * Called by GET /api/orders/:id/pipeline-status
 *
 * @returns {DashboardPayload}
 */
export const buildOrderPipelineDashboard = async (orderId) => {
  // One round-trip: load order + pipeline + all steps + all jobs
  const [order, pipeline, queueHealth] = await Promise.all([
    prisma.cardOrder.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        order_number: true,
        status: true,
        card_count: true,
        order_type: true,
        channel: true,
        created_at: true,
        school: { select: { id: true, name: true, code: true } },
        tokenBatches: {
          orderBy: { created_at: "desc" },
          take: 1,
          select: {
            id: true,
            status: true,
            count: true,
            generated_count: true,
            failed_count: true,
            completed_at: true,
            error_log: true,
          },
        },
      },
    }),
    pipelineRepo.findPipelineByOrderId(orderId),
    getQueueHealth(),
  ]);

  if (!order) throw new Error("Order not found");

  const latestBatch = order.tokenBatches[0] ?? null;

  // Build step timeline
  const stepMap = buildStepMap(pipeline?.steps ?? []);
  const timeline = STEP_ORDER.map((stepName) =>
    buildTimelineEntry(stepName, stepMap[stepName]),
  );

  // Identify the active step
  const activeStep = pipeline?.steps.find((s) => s.status === "RUNNING");

  // Aggregate job stats for the active step
  const activeJobStats = activeStep ? summariseJobs(activeStep.jobs) : null;

  // Token generation specific detail
  const tokenDetail = latestBatch
    ? {
        batchId: latestBatch.id,
        batchStatus: latestBatch.status,
        total: latestBatch.count,
        generated: latestBatch.generated_count,
        failed: latestBatch.failed_count,
        completedAt: latestBatch.completed_at,
        pct:
          latestBatch.count > 0
            ? Math.round(
                (latestBatch.generated_count / latestBatch.count) * 100,
              )
            : 0,
        failedTokenIds: latestBatch.error_log?.failed ?? [],
      }
    : null;

  // Step logs for the active step (last 50 lines)
  const recentLogs = activeStep
    ? await pipelineRepo.getStepLogs(activeStep.id, { limit: 50 })
    : [];

  return {
    // ── Order summary ────────────────────────────────────────────────────────
    order: {
      id: order.id,
      orderNumber: order.order_number,
      status: order.status,
      cardCount: order.card_count,
      orderType: order.order_type,
      channel: order.channel,
      school: order.school,
      createdAt: order.created_at,
    },

    // ── Pipeline summary ─────────────────────────────────────────────────────
    pipeline: pipeline
      ? {
          id: pipeline.id,
          currentStep: pipeline.current_step,
          currentStepLabel:
            STEP_LABELS[pipeline.current_step] ?? pipeline.current_step,
          overallProgress: pipeline.overall_progress,
          isStalled: pipeline.is_stalled,
          stalledAt: pipeline.stalled_at,
          stalledReason: pipeline.stalled_reason,
        }
      : null,

    // ── Step-by-step timeline ────────────────────────────────────────────────
    // Frontend renders this as a vertical progress list
    timeline,

    // ── Active step detail ───────────────────────────────────────────────────
    activeStep: activeStep
      ? {
          step: activeStep.step,
          label: STEP_LABELS[activeStep.step],
          isAsync: ASYNC_STEPS.has(activeStep.step),
          progress: activeStep.progress,
          progressDetail: activeStep.progress_detail,
          startedAt: activeStep.started_at,
          elapsedMs: activeStep.started_at
            ? Date.now() - new Date(activeStep.started_at).getTime()
            : null,
          jobs: activeJobStats,
        }
      : null,

    // ── Token generation detail ──────────────────────────────────────────────
    tokenGeneration: tokenDetail,

    // ── Worker / queue health ────────────────────────────────────────────────
    // Super admin can see global queue state from this order's page too
    queueHealth: {
      tokenGeneration: queueHealth.token_generation,
      cardDesign: queueHealth.card_design,
    },

    // ── Recent logs ──────────────────────────────────────────────────────────
    logs: recentLogs.map((l) => ({
      level: l.level,
      message: l.message,
      context: l.context,
      at: l.created_at,
    })),
  };
};

/**
 * Build the school admin view — stripped of internal details.
 */
export const buildSchoolAdminPipelineView = async (orderId) => {
  const [order, pipeline] = await Promise.all([
    prisma.cardOrder.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        order_number: true,
        status: true,
        card_count: true,
        payment_status: true,
        balance_due_at: true,
        shipment: {
          select: {
            status: true,
            courier_name: true,
            tracking_url: true,
            awb_code: true,
            delivered_at: true,
          },
        },
      },
    }),
    pipelineRepo.findPipelineByOrderIdLight(orderId),
  ]);

  if (!order) throw new Error("Order not found");

  // Coarse phases — school admin sees phases, not steps
  const phases = buildCoarsePhases(order.status);

  return {
    orderNumber: order.order_number,
    cardCount: order.card_count,
    paymentStatus: order.payment_status,
    phases, // [{ name, label, status }]
    overallProgress: pipeline?.overall_progress ?? 0,
    shipment: order.shipment
      ? {
          status: order.shipment.status,
          courier: order.shipment.courier_name,
          trackingUrl: order.shipment.tracking_url,
          awbCode: order.shipment.awb_code,
          deliveredAt: order.shipment.delivered_at,
        }
      : null,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const buildStepMap = (steps) => {
  const map = {};
  for (const step of steps) {
    const existing = map[step.step];
    // Keep the latest attempt
    if (!existing || step.attempt_number > existing.attempt_number) {
      map[step.step] = step;
    }
  }
  return map;
};

const buildTimelineEntry = (stepName, exec) => ({
  step: stepName,
  label: STEP_LABELS[stepName] ?? stepName,
  isAsync: ASYNC_STEPS.has(stepName),
  status: exec?.status ?? "PENDING",
  progress: exec?.progress ?? 0,
  attemptNumber: exec?.attempt_number ?? null,
  startedAt: exec?.started_at ?? null,
  completedAt: exec?.completed_at ?? null,
  durationMs: exec?.duration_ms ?? null,
  hasError: !!exec?.error_log,
  resultSummary: exec?.result_summary ?? null,
});

const summariseJobs = (jobs) => ({
  total: jobs.length,
  queued: jobs.filter((j) => j.status === "QUEUED").length,
  running: jobs.filter((j) => j.status === "RUNNING").length,
  completed: jobs.filter((j) => j.status === "COMPLETED").length,
  failed: jobs.filter((j) => ["FAILED", "DEAD"].includes(j.status)).length,
  avgProgress: jobs.length
    ? Math.round(jobs.reduce((sum, j) => sum + j.progress, 0) / jobs.length)
    : 0,
});

// Map order status to coarse phases for school admin view
const buildCoarsePhases = (orderStatus) => {
  const ORDER_PHASE_MAP = {
    PENDING: 0,
    CONFIRMED: 1,
    PAYMENT_PENDING: 1,
    ADVANCE_RECEIVED: 1,
    TOKEN_GENERATION: 2,
    TOKEN_GENERATED: 2,
    CARD_DESIGN: 2,
    CARD_DESIGN_READY: 2,
    CARD_DESIGN_REVISION: 2,
    SENT_TO_VENDOR: 2,
    PRINTING: 2,
    PRINT_COMPLETE: 2,
    READY_TO_SHIP: 3,
    SHIPPED: 3,
    OUT_FOR_DELIVERY: 3,
    DELIVERED: 3,
    BALANCE_PENDING: 4,
    COMPLETED: 5,
  };

  const currentPhase = ORDER_PHASE_MAP[orderStatus] ?? 0;
  const phases = [
    { id: 0, name: "ORDER_PLACED", label: "Order placed" },
    { id: 1, name: "PAYMENT", label: "Payment confirmed" },
    { id: 2, name: "PRODUCTION", label: "Cards in production" },
    { id: 3, name: "SHIPPING", label: "Cards shipped" },
    { id: 4, name: "COMPLETION", label: "Order complete" },
  ];

  return phases.map((p) => ({
    ...p,
    status:
      p.id < currentPhase
        ? "COMPLETED"
        : p.id === currentPhase
          ? "ACTIVE"
          : "PENDING",
  }));
};
