// =============================================================================
// pipeline/step4.generate.js — RESQID (v3 — idempotency hardened)
//
// FIXES IN THIS VERSION:
//   [F-1] Enqueue rollback: if BullMQ add() throws after batch creation,
//         mark batch FAILED so the PENDING idempotency guard doesn't block
//         the next attempt.
//   [F-2] Optimistic-lock on status: use updateMany({ where: { status } })
//         instead of read-then-update to prevent concurrent double-trigger.
//   [F-3] is_stalled cleared on retry entry (handled in pipeline.retry.js).
// =============================================================================

import * as repo from "../order.repository.js";
import * as pipelineRepo from "./pipeline.repository.js";
import { enqueueTokenGeneration } from "../../../services/jobs/queue.service.js";
import { writeAuditLog } from "../../../utils/helpers/auditLogger.js";
import { ApiError } from "../../../utils/response/ApiError.js";
import { logger } from "../../../config/logger.js";
import { prisma } from "../../../config/prisma.js";

const MAX_CARDS_PER_ORDER = 1500;

export const generateTokensStep = async ({ orderId, adminId, note, ip }) => {
  // ── 1. Fetch + basic guards ───────────────────────────────────────────────
  const order = await repo.findOrderById(orderId);
  if (!order) throw ApiError.notFound("Order not found");
  if (!order.school) throw ApiError.internal("Order has no linked school");

  if (order.status !== "ADVANCE_RECEIVED") {
    throw ApiError.badRequest(
      `Cannot generate tokens for order in status: ${order.status}. Expected: ADVANCE_RECEIVED`,
    );
  }

  if (order.card_count > MAX_CARDS_PER_ORDER) {
    throw ApiError.badRequest(
      `card_count ${order.card_count} exceeds max ${MAX_CARDS_PER_ORDER}`,
    );
  }

  // ── 2. Idempotency guard ──────────────────────────────────────────────────
  const existingBatch = await prisma.tokenBatch.findFirst({
    where: {
      order_id: orderId,
      status: { in: ["PENDING", "PROCESSING", "COMPLETE"] },
    },
    select: { id: true, status: true, generated_count: true },
  });
  if (existingBatch) {
    if (existingBatch.status === "COMPLETE") {
      throw ApiError.conflict(
        `Tokens already generated for this order (batch: ${existingBatch.id}). ` +
          `${existingBatch.generated_count} tokens exist.`,
      );
    }
    throw ApiError.conflict(
      `Token generation already ${existingBatch.status} (batch: ${existingBatch.id}). ` +
        `Check /pipeline-status for progress.`,
    );
  }

  // ── 3. PRE_DETAILS item check ─────────────────────────────────────────────
  const isPreDetails = order.order_type === "PRE_DETAILS";
  if (isPreDetails) {
    if (!order.items?.length) {
      throw ApiError.badRequest(
        "PRE_DETAILS order has no items — upload student list first",
      );
    }
    if (order.items.length !== order.card_count) {
      throw ApiError.badRequest(
        `card_count (${order.card_count}) doesn't match items (${order.items.length})`,
      );
    }
  }

  // ── 4. [F-2] Optimistic status lock — prevents concurrent double-trigger ──
  // updateMany with status guard: if another request already moved the order
  // to TOKEN_GENERATION, count === 0 and we throw instead of proceeding.
  const lockResult = await prisma.cardOrder.updateMany({
    where: { id: orderId, status: "ADVANCE_RECEIVED" },
    data: {
      status: "TOKEN_GENERATION",
      status_changed_by: adminId,
      status_changed_at: new Date(),
    },
  });
  if (lockResult.count === 0) {
    throw ApiError.conflict(
      "Order status changed during operation — another trigger may be in progress",
    );
  }

  // ── 5. Create TokenBatch ───────────────────────────────────────────────────
  const batch = await prisma.tokenBatch.create({
    data: {
      school_id: order.school.id,
      order_id: orderId,
      count: order.card_count,
      created_by: adminId,
      status: "PENDING",
      notes: note ?? `Order ${order.order_number}`,
    },
  });

  // ── 6. Get or create pipeline + step execution ────────────────────────────
  let pipeline = await pipelineRepo
    .findPipelineByOrderId(orderId)
    .catch(() => null);
  if (!pipeline) {
    pipeline = await pipelineRepo.createPipeline(
      orderId,
      "TOKEN_GENERATION",
      adminId,
    );
  } else {
    await pipelineRepo.updatePipeline(pipeline.id, {
      current_step: "TOKEN_GENERATION",
      is_stalled: false,
      stalled_at: null,
      stalled_reason: null,
    });
  }

  const stepExecution = await pipelineRepo.createStepExecution({
    pipelineId: pipeline.id,
    orderId,
    step: "TOKEN_GENERATION",
    adminId,
  });

  // ── 7. Write status log ───────────────────────────────────────────────────
  await repo.writeStatusLog({
    orderId,
    fromStatus: "ADVANCE_RECEIVED",
    toStatus: "TOKEN_GENERATION",
    changedBy: adminId,
    note: note ?? `Queuing ${order.card_count} token generation`,
    metadata: { card_count: order.card_count, batch_id: batch.id },
  });

  // ── 8. [F-1] Enqueue with rollback on failure ─────────────────────────────
  let jobExecutionId, bullJobId;
  try {
    ({ jobExecutionId, bullJobId } = await enqueueTokenGeneration({
      stepExecutionId: stepExecution.id,
      orderId,
      batchId: batch.id,
      schoolId: order.school.id,
      cardCount: order.card_count,
      isPreDetails,
      adminId,
      ip,
    }));
  } catch (enqueueErr) {
    // Rollback: mark batch FAILED so the next attempt can create a fresh one
    await prisma.tokenBatch
      .update({
        where: { id: batch.id },
        data: {
          status: "FAILED",
          error_log: { enqueue_error: enqueueErr.message, at: new Date() },
        },
      })
      .catch(() => {});
    await pipelineRepo
      .markStepFailed(stepExecution.id, {
        message: enqueueErr.message,
        phase: "enqueue",
      })
      .catch(() => {});
    throw ApiError.serviceUnavailable(
      `Failed to queue token generation: ${enqueueErr.message}`,
    );
  }

  logger.info(
    `[step4] Enqueued: order=${orderId} batch=${batch.id} job=${jobExecutionId} cards=${order.card_count}`,
  );

  writeAuditLog({
    actorId: adminId,
    actorType: "SUPER_ADMIN",
    schoolId: order.school.id,
    action: "TOKEN_GENERATION_QUEUED",
    entity: "CardOrder",
    entityId: orderId,
    newValue: {
      batch_id: batch.id,
      job_execution_id: jobExecutionId,
      card_count: order.card_count,
    },
    ip,
  }).catch(() => {});

  return {
    batchId: batch.id,
    jobExecutionId,
    bullJobId,
    status: "QUEUED",
    cardCount: order.card_count,
    pollUrl: `/api/orders/${orderId}/progress`,
    message: `Token generation queued for ${order.card_count} cards. Poll /progress for updates.`,
  };
};
