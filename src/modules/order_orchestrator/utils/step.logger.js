// =============================================================================
// utils/step.logger.js
// Writes structured StepLog rows to the DB.
// Workers call this throughout execution — it is the "tail" the admin sees.
// =============================================================================

import { prisma } from "../../../config/prisma.js";
import { logger as pinoLogger } from "../../../config/logger.js";

/**
 * Write an info-level step log.
 */
export async function stepLog(
  stepExecutionId,
  orderId,
  message,
  context = {},
  jobExecutionId = null,
) {
  return _write(
    stepExecutionId,
    orderId,
    "info",
    message,
    context,
    jobExecutionId,
  );
}

/**
 * Write a warn-level step log.
 */
export async function stepWarn(
  stepExecutionId,
  orderId,
  message,
  context = {},
  jobExecutionId = null,
) {
  return _write(
    stepExecutionId,
    orderId,
    "warn",
    message,
    context,
    jobExecutionId,
  );
}

/**
 * Write an error-level step log.
 */
export async function stepError(
  stepExecutionId,
  orderId,
  message,
  context = {},
  jobExecutionId = null,
) {
  return _write(
    stepExecutionId,
    orderId,
    "error",
    message,
    context,
    jobExecutionId,
  );
}

async function _write(
  stepExecutionId,
  orderId,
  level,
  message,
  context,
  jobExecutionId,
) {
  try {
    await prisma.stepLog.create({
      data: {
        step_execution_id: stepExecutionId,
        order_id: orderId,
        job_execution_id: jobExecutionId ?? undefined,
        level,
        message,
        context: Object.keys(context).length ? context : undefined,
      },
    });
  } catch (err) {
    // StepLog writes must NEVER crash the worker — degrade gracefully
    pinoLogger.warn({
      msg: "StepLog write failed (non-fatal)",
      err: err.message,
      stepExecutionId,
      orderId,
    });
  }

  // Always mirror to pino for log aggregation
  pinoLogger[level]?.({ msg: message, stepExecutionId, orderId, ...context });
}
