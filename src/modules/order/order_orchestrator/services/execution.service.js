// =============================================================================
// services/execution.service.js
// Creates and manages OrderStepExecution + JobExecution records.
// Workers use this to record their lifecycle in the append-only log.
// =============================================================================

import { prisma } from '#config/database/prisma.js';
import { logger } from '#config/logger.js';

// =============================================================================
// StepExecution
// =============================================================================

/**
 * Create a new StepExecution row (RUNNING state).
 * If one already exists for this (pipeline_id, step), increments attempt_number.
 */
export async function beginStepExecution(pipelineId, orderId, step, triggeredBy) {
  // Find highest existing attempt for this step
  const last = await prisma.orderStepExecution.findFirst({
    where: { pipeline_id: pipelineId, step },
    orderBy: { attempt_number: 'desc' },
    select: { attempt_number: true },
  });

  const attemptNumber = (last?.attempt_number ?? 0) + 1;

  const execution = await prisma.orderStepExecution.create({
    data: {
      pipeline_id: pipelineId,
      order_id: orderId,
      step,
      attempt_number: attemptNumber,
      status: 'RUNNING',
      started_at: new Date(),
      triggered_by: triggeredBy,
    },
  });

  logger.info({
    msg: 'StepExecution started',
    id: execution.id,
    step,
    orderId,
    attempt: attemptNumber,
  });
  return execution;
}

/**
 * Mark a StepExecution as COMPLETED.
 */
export async function completeStepExecution(executionId, resultSummary = {}) {
  const now = new Date();
  const execution = await prisma.orderStepExecution.findUnique({
    where: { id: executionId },
    select: { started_at: true },
  });

  const durationMs = execution?.started_at
    ? now.getTime() - new Date(execution.started_at).getTime()
    : null;

  return prisma.orderStepExecution.update({
    where: { id: executionId },
    data: {
      status: 'COMPLETED',
      completed_at: now,
      duration_ms: durationMs,
      progress: 100,
      result_summary: resultSummary,
    },
  });
}

/**
 * Mark a StepExecution as FAILED with error details.
 */
export async function failStepExecution(executionId, error, errorLog = []) {
  return prisma.orderStepExecution.update({
    where: { id: executionId },
    data: {
      status: 'FAILED',
      completed_at: new Date(),
      error_log: errorLog.length
        ? errorLog
        : [{ error: error?.message, at: new Date().toISOString() }],
    },
  });
}

/**
 * Update progress on a running StepExecution.
 */
export async function updateStepProgress(executionId, progress, detail = null) {
  return prisma.orderStepExecution.update({
    where: { id: executionId },
    data: {
      progress,
      progress_detail: detail ?? undefined,
    },
  });
}

// =============================================================================
// JobExecution
// =============================================================================

/**
 * Create a JobExecution record when a BullMQ job starts.
 */
export async function beginJobExecution(
  stepExecutionId,
  orderId,
  queueName,
  jobName,
  payload,
  bullmqJobId
) {
  return prisma.jobExecution.create({
    data: {
      step_execution_id: stepExecutionId,
      order_id: orderId,
      queue_name: queueName,
      bullmq_job_id: bullmqJobId,
      job_name: jobName,
      status: 'RUNNING',
      payload,
      started_at: new Date(),
    },
  });
}

/**
 * Mark JobExecution as COMPLETED.
 */
export async function completeJobExecution(jobExecId, result = {}) {
  const now = new Date();
  const record = await prisma.jobExecution.findUnique({
    where: { id: jobExecId },
    select: { started_at: true },
  });

  return prisma.jobExecution.update({
    where: { id: jobExecId },
    data: {
      status: 'COMPLETED',
      completed_at: now,
      duration_ms: record?.started_at
        ? now.getTime() - new Date(record.started_at).getTime()
        : null,
      progress: 100,
      result,
    },
  });
}

/**
 * Mark JobExecution as FAILED.
 */
export async function failJobExecution(jobExecId, error, attempt) {
  return prisma.jobExecution.update({
    where: { id: jobExecId },
    data: {
      status: 'FAILED',
      completed_at: new Date(),
      last_error: error?.message,
      attempt_number: attempt,
      error_log: [{ attempt, error: error?.message, at: new Date().toISOString() }],
    },
  });
}
