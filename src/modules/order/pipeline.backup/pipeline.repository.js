// =============================================================================
// pipeline.repository.js — RESQID
// All DB reads/writes for OrderPipeline, OrderStepExecution, JobExecution.
// No business logic — pure Prisma queries.
// =============================================================================

import { prisma } from "../../../config/prisma.js";

// ─────────────────────────────────────────────────────────────────────────────
// PIPELINE — create + read
// ─────────────────────────────────────────────────────────────────────────────

export const createPipeline = (orderId, firstStep, adminId) =>
  prisma.orderPipeline.create({
    data: {
      order_id: orderId,
      current_step: firstStep,
      overall_progress: 0,
    },
  });

export const findPipelineByOrderId = (orderId) =>
  prisma.orderPipeline.findUnique({
    where: { order_id: orderId },
    include: {
      steps: {
        orderBy: [{ triggered_at: "asc" }, { attempt_number: "asc" }],
        include: { jobs: { orderBy: { queued_at: "asc" } } },
      },
    },
  });

export const findPipelineByOrderIdLight = (orderId) =>
  prisma.orderPipeline.findUnique({
    where: { order_id: orderId },
    select: {
      id: true,
      current_step: true,
      overall_progress: true,
      is_stalled: true,
      stalled_at: true,
      stalled_reason: true,
      steps: {
        select: {
          id: true,
          step: true,
          status: true,
          progress: true,
          attempt_number: true,
          started_at: true,
          completed_at: true,
          duration_ms: true,
          result_summary: true,
          error_log: true,
        },
        orderBy: [{ triggered_at: "asc" }, { attempt_number: "asc" }],
      },
    },
  });

export const updatePipeline = (pipelineId, data) =>
  prisma.orderPipeline.update({ where: { id: pipelineId }, data });

export const markPipelineStalled = (pipelineId, reason) =>
  prisma.orderPipeline.update({
    where: { id: pipelineId },
    data: { is_stalled: true, stalled_at: new Date(), stalled_reason: reason },
  });

export const markPipelineUnstalled = (pipelineId) =>
  prisma.orderPipeline.update({
    where: { id: pipelineId },
    data: { is_stalled: false, stalled_at: null, stalled_reason: null },
  });

// ─────────────────────────────────────────────────────────────────────────────
// STEP EXECUTION
// ─────────────────────────────────────────────────────────────────────────────

// Find the latest attempt for a step on an order
export const findLatestStepExecution = async (pipelineId, step) => {
  return prisma.orderStepExecution.findFirst({
    where: { pipeline_id: pipelineId, step },
    orderBy: { attempt_number: "desc" },
    include: { jobs: { orderBy: { queued_at: "asc" } } },
  });
};

// Get next attempt number for a step (for retries)
export const getNextAttemptNumber = async (pipelineId, step) => {
  const existing = await prisma.orderStepExecution.count({
    where: { pipeline_id: pipelineId, step },
  });
  return existing + 1;
};

// Create a new step execution (fresh start or retry)
export const createStepExecution = async ({
  pipelineId,
  orderId,
  step,
  adminId,
}) => {
  const attemptNumber = await getNextAttemptNumber(pipelineId, step);
  return prisma.orderStepExecution.create({
    data: {
      pipeline_id: pipelineId,
      order_id: orderId,
      step,
      attempt_number: attemptNumber,
      status: "PENDING",
      triggered_by: adminId,
    },
  });
};

// Mark a step as RUNNING (worker picked it up)
export const markStepRunning = (stepExecutionId) =>
  prisma.orderStepExecution.update({
    where: { id: stepExecutionId },
    data: { status: "RUNNING", started_at: new Date() },
  });

// Update progress of a running step (called frequently by workers)
export const updateStepProgress = (stepExecutionId, progress, detail = null) =>
  prisma.orderStepExecution.update({
    where: { id: stepExecutionId },
    data: {
      progress,
      progress_detail: detail,
    },
  });

// Mark step complete
export const markStepCompleted = (stepExecutionId, resultSummary = null) => {
  const now = new Date();
  return prisma.orderStepExecution.update({
    where: { id: stepExecutionId },
    data: {
      status: "COMPLETED",
      completed_at: now,
      result_summary: resultSummary,
      progress: 100,
    },
  });
};

// Mark step completed but with partial failures
export const markStepPartialFailed = (
  stepExecutionId,
  resultSummary,
  errorLog,
) => {
  const now = new Date();
  return prisma.orderStepExecution.update({
    where: { id: stepExecutionId },
    data: {
      status: "PARTIAL_FAILED",
      completed_at: now,
      result_summary: resultSummary,
      error_log: errorLog,
    },
  });
};

// Mark step failed
export const markStepFailed = (stepExecutionId, errorLog) => {
  const now = new Date();
  return prisma.orderStepExecution.update({
    where: { id: stepExecutionId },
    data: {
      status: "FAILED",
      completed_at: now,
      error_log: errorLog,
    },
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// JOB EXECUTION
// ─────────────────────────────────────────────────────────────────────────────

export const createJobExecution = ({
  stepExecutionId,
  orderId,
  queueName,
  jobName,
  payload,
  maxAttempts = 3,
}) =>
  prisma.jobExecution.create({
    data: {
      step_execution_id: stepExecutionId,
      order_id: orderId,
      queue_name: queueName,
      job_name: jobName,
      status: "QUEUED",
      payload,
      max_attempts: maxAttempts,
    },
  });

export const updateJobBullId = (jobExecutionId, bullmqJobId) =>
  prisma.jobExecution.update({
    where: { id: jobExecutionId },
    data: { bullmq_job_id: bullmqJobId },
  });

export const markJobRunning = (jobExecutionId) =>
  prisma.jobExecution.update({
    where: { id: jobExecutionId },
    data: { status: "RUNNING", started_at: new Date() },
  });

export const updateJobProgress = (jobExecutionId, progress) =>
  prisma.jobExecution.update({
    where: { id: jobExecutionId },
    data: { progress },
  });

export const markJobCompleted = (jobExecutionId, result = null) => {
  const now = new Date();
  return prisma.jobExecution.update({
    where: { id: jobExecutionId },
    data: {
      status: "COMPLETED",
      completed_at: now,
      progress: 100,
      result,
    },
  });
};

export const markJobFailed = (jobExecutionId, error, attemptNumber) => {
  const now = new Date();
  return prisma.jobExecution.update({
    where: { id: jobExecutionId },
    data: {
      status: attemptNumber >= 3 ? "DEAD" : "RETRYING",
      last_error: error.message,
      error_log: {
        [attemptNumber]: { error: error.message, at: now.toISOString() },
      },
      attempt_number: attemptNumber,
    },
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// STEP LOGS
// ─────────────────────────────────────────────────────────────────────────────

export const writeStepLog = (
  stepExecutionId,
  orderId,
  level,
  message,
  context = null,
  jobExecutionId = null,
) =>
  prisma.stepLog
    .create({
      data: {
        step_execution_id: stepExecutionId,
        order_id: orderId,
        job_execution_id: jobExecutionId,
        level,
        message,
        context,
      },
    })
    .catch(() => {}); // fire-and-forget — never let logging crash the pipeline

export const getStepLogs = (stepExecutionId, { limit = 100, since } = {}) =>
  prisma.stepLog.findMany({
    where: {
      step_execution_id: stepExecutionId,
      ...(since ? { created_at: { gt: since } } : {}),
    },
    orderBy: { created_at: "asc" },
    take: limit,
  });

// ─────────────────────────────────────────────────────────────────────────────
// DASHBOARD QUERIES
// ─────────────────────────────────────────────────────────────────────────────

// Get all stalled pipelines — for the super admin alert panel
export const findStalledPipelines = () =>
  prisma.orderPipeline.findMany({
    where: { is_stalled: true, completed_at: null },
    include: {
      order: {
        select: {
          id: true,
          order_number: true,
          school: { select: { name: true } },
        },
      },
    },
    orderBy: { stalled_at: "asc" },
  });

// Get jobs in a bad state across all queues — for worker health panel
export const findDeadJobs = ({ limit = 50 } = {}) =>
  prisma.jobExecution.findMany({
    where: { status: { in: ["DEAD", "FAILED"] } },
    orderBy: { queued_at: "desc" },
    take: limit,
    include: {
      stepExecution: {
        select: { step: true, order_id: true },
      },
    },
  });

// Per-order pipeline summary for the list view
export const getPipelineSummaryForOrders = (orderIds) =>
  prisma.orderPipeline.findMany({
    where: { order_id: { in: orderIds } },
    select: {
      order_id: true,
      current_step: true,
      overall_progress: true,
      is_stalled: true,
    },
  });
