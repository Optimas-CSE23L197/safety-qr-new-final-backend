// =============================================================================
// pipeline.retry.js — RESQID (v2 — hardened)
//
// FIXES IN THIS VERSION:
//   [F-1] is_stalled cleared on every retry so dashboard shows live state.
//   [F-2] COMPLETE batch guard: retryTokenGeneration now explicitly rejects
//         retries when the batch is already complete.
//   [F-3] Optimistic status lock on order revert (updateMany with status guard).
// =============================================================================

import { ApiError } from "../../../utils/response/ApiError.js";
import { logger } from "../../../config/logger.js";
import { prisma } from "../../../config/prisma.js";
import * as pipelineRepo from "./pipeline.repository.js";
import {
  enqueueTokenGeneration,
  enqueueCardDesign,
} from "../../../services/jobs/queue.service.js";

const RETRYABLE_STEPS = new Set(["TOKEN_GENERATION", "CARD_DESIGN"]);

export const retryPipelineStep = async ({ orderId, step, adminId, ip }) => {
  if (!RETRYABLE_STEPS.has(step)) {
    throw ApiError.badRequest(
      `Step ${step} is not retryable. Manual steps must be re-triggered via their pipeline endpoint.`,
    );
  }

  const pipeline = await pipelineRepo.findPipelineByOrderId(orderId);
  if (!pipeline) throw ApiError.notFound("Pipeline not found for this order");

  const latestExec = await pipelineRepo.findLatestStepExecution(
    pipeline.id,
    step,
  );
  if (!latestExec) {
    throw ApiError.badRequest(`Step ${step} has not been executed yet`);
  }

  if (!["FAILED", "PARTIAL_FAILED"].includes(latestExec.status)) {
    throw ApiError.badRequest(
      `Step ${step} is in status ${latestExec.status} — only FAILED or PARTIAL_FAILED can be retried`,
    );
  }

  // [F-1] Always clear stall flag when admin initiates a retry
  await pipelineRepo.markPipelineUnstalled(pipeline.id).catch(() => {});

  logger.info(
    `[retry] Retrying step=${step} order=${orderId} admin=${adminId}`,
  );

  switch (step) {
    case "TOKEN_GENERATION":
      return retryTokenGeneration({ pipeline, orderId, adminId, ip });
    case "CARD_DESIGN":
      return retryCardDesign({ pipeline, orderId, adminId, ip });
    default:
      throw ApiError.internal(`No retry handler for step: ${step}`);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// TOKEN GENERATION RETRY
// ─────────────────────────────────────────────────────────────────────────────

const retryTokenGeneration = async ({ pipeline, orderId, adminId, ip }) => {
  const existingBatch = await prisma.tokenBatch.findFirst({
    where: {
      order_id: orderId,
      status: { in: ["PARTIAL", "FAILED", "PENDING"] },
    },
    orderBy: { created_at: "desc" },
    select: { id: true, status: true, generated_count: true, count: true },
  });

  if (!existingBatch) {
    // [F-2] Check if batch is COMPLETE — distinct error message
    const completeBatch = await prisma.tokenBatch.findFirst({
      where: { order_id: orderId, status: "COMPLETE" },
      select: { id: true, generated_count: true },
    });
    if (completeBatch) {
      throw ApiError.conflict(
        `Token batch is already COMPLETE (${completeBatch.generated_count} tokens). ` +
          `No retry needed — use the normal generate endpoint if you need a fresh batch.`,
      );
    }
    throw ApiError.badRequest(
      "No retryable batch found. Use the normal generate endpoint.",
    );
  }

  const order = await prisma.cardOrder.findUnique({
    where: { id: orderId },
    select: {
      order_type: true,
      card_count: true,
      school_id: true,
      status: true,
    },
  });

  // [F-3] Optimistic lock on order revert
  const lockResult = await prisma.cardOrder.updateMany({
    where: {
      id: orderId,
      status: { in: ["TOKEN_GENERATION", "TOKEN_GENERATED"] },
    },
    data: { status: "TOKEN_GENERATION" },
  });
  if (lockResult.count === 0) {
    throw ApiError.conflict(
      `Cannot revert order to TOKEN_GENERATION from status: ${order.status}`,
    );
  }

  const stepExecution = await pipelineRepo.createStepExecution({
    pipelineId: pipeline.id,
    orderId,
    step: "TOKEN_GENERATION",
    adminId,
  });

  await pipelineRepo.writeStepLog(
    stepExecution.id,
    orderId,
    "warn",
    `Retry initiated. Existing batch ${existingBatch.id} has ${existingBatch.generated_count}/${existingBatch.count} tokens.`,
    { batchId: existingBatch.id, existingCount: existingBatch.generated_count },
  );

  const { jobExecutionId } = await enqueueTokenGeneration({
    stepExecutionId: stepExecution.id,
    orderId,
    batchId: existingBatch.id,
    schoolId: order.school_id,
    cardCount: order.card_count,
    isPreDetails: order.order_type === "PRE_DETAILS",
    adminId,
    ip,
  });

  return {
    stepExecutionId: stepExecution.id,
    jobExecutionId,
    batchId: existingBatch.id,
    existingTokens: existingBatch.generated_count,
    remainingTokens: existingBatch.count - existingBatch.generated_count,
    message: `Retry queued. Worker will generate ${existingBatch.count - existingBatch.generated_count} remaining tokens.`,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// CARD DESIGN RETRY
// ─────────────────────────────────────────────────────────────────────────────

const retryCardDesign = async ({ pipeline, orderId, adminId, ip }) => {
  const order = await prisma.cardOrder.findUnique({
    where: { id: orderId },
    select: { school_id: true, status: true },
  });

  await prisma.cardOrder.update({
    where: { id: orderId },
    data: {
      status: "TOKEN_GENERATED",
      card_design_files: null,
      card_design_at: null,
      card_design_by: null,
    },
  });

  const stepExecution = await pipelineRepo.createStepExecution({
    pipelineId: pipeline.id,
    orderId,
    step: "CARD_DESIGN",
    adminId,
  });

  const { jobExecutionId } = await enqueueCardDesign({
    stepExecutionId: stepExecution.id,
    orderId,
    schoolId: order.school_id,
    adminId,
    ip,
  });

  return {
    stepExecutionId: stepExecution.id,
    jobExecutionId,
    message: "Card design retry queued.",
  };
};
