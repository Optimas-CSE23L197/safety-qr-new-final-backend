// =============================================================================
// policies/escalation.policy.js
// Manages escalation rules for failed steps, stalled pipelines, and critical issues.
// Determines when to notify super admins, send alerts, or trigger manual intervention.
// =============================================================================

import { logger } from "../../../config/logger.js";
import { redis } from "../../../config/redis.js";
import { REDIS_KEYS, STALL_THRESHOLD_MS } from "../orchestrator.constants.js";
import { publishNotification } from "../events/event.publisher.js";
import { NOTIFICATION_EVENTS } from "../notifications/notification.events.js";
import { prisma } from "../../../config/prisma.js";

// =============================================================================
// ESCALATION CONFIGURATION
// =============================================================================

const ESCALATION_CONFIG = {
  // Step failures: escalate after N retries
  STEP_FAILURE_RETRY_THRESHOLD: {
    CRITICAL: 2, // Token generation, payment processing
    HIGH: 3, // Card design, vendor assignment
    MEDIUM: 4, // Printing, shipment
    LOW: 5, // Notifications, logging
  },

  // Stalled pipeline: escalate after N minutes
  STALLED_THRESHOLD_MINUTES: {
    CRITICAL: 15, // Payment, token generation
    HIGH: 30, // Card design, vendor
    MEDIUM: 60, // Printing, shipment
    LOW: 120, // Completion, cleanup
  },

  // DLQ: escalate after N jobs in queue
  DLQ_JOB_THRESHOLD: 5,

  // Failure rate: escalate if failure rate > X% in last hour
  FAILURE_RATE_THRESHOLD: 30, // percent
};

// =============================================================================
// STEP SEVERITY MAPPING
// =============================================================================

const STEP_SEVERITY = {
  // Critical steps - immediate escalation after few retries
  TOKEN_GENERATION: "CRITICAL",
  ADVANCE_PAYMENT: "CRITICAL",
  BALANCE_PAYMENT: "CRITICAL",

  // High severity - needs attention soon
  CARD_DESIGN: "HIGH",
  VENDOR_DISPATCH: "HIGH",
  PRINTING_START: "HIGH",

  // Medium severity - can wait
  PRINTING_DONE: "MEDIUM",
  SHIPMENT_CREATE: "MEDIUM",
  DELIVERY: "MEDIUM",

  // Low severity - auto-retry sufficient
  NOTIFICATION: "LOW",
  AUDIT_LOG: "LOW",
};

// =============================================================================
// ESCALATION DECISION FUNCTIONS
// =============================================================================

/**
 * Determine if a step failure should be escalated to super admin.
 *
 * @param {string} step - PipelineStepName
 * @param {number} retryCount - Number of retry attempts made
 * @param {object} error - Error object
 * @returns {object} { shouldEscalate: boolean, severity: string, reason: string }
 */
export const shouldEscalateStepFailure = (step, retryCount, error) => {
  const severity = STEP_SEVERITY[step] || "MEDIUM";
  const threshold = ESCALATION_CONFIG.STEP_FAILURE_RETRY_THRESHOLD[severity];

  // Check if retry count exceeds threshold
  if (retryCount >= threshold) {
    return {
      shouldEscalate: true,
      severity,
      reason: `Step ${step} failed after ${retryCount} retries (threshold: ${threshold})`,
    };
  }

  // Check for critical errors that should escalate immediately
  const criticalErrorMessages = [
    "database connection",
    "redis connection",
    "authentication failed",
    "permission denied",
    "insufficient funds",
    "vendor API unreachable",
  ];

  const errorMsg = error?.message?.toLowerCase() || "";
  const isCriticalError = criticalErrorMessages.some((msg) =>
    errorMsg.includes(msg),
  );

  if (isCriticalError && severity !== "LOW") {
    return {
      shouldEscalate: true,
      severity,
      reason: `Critical error in step ${step}: ${error.message}`,
    };
  }

  return {
    shouldEscalate: false,
    severity,
    reason: null,
  };
};

/**
 * Determine if a stalled pipeline should be escalated.
 *
 * @param {string} step - Current pipeline step
 * @param {Date} stalledAt - When the pipeline stalled
 * @returns {object} { shouldEscalate: boolean, severity: string, reason: string }
 */
export const shouldEscalateStalledPipeline = (step, stalledAt) => {
  const severity = STEP_SEVERITY[step] || "MEDIUM";
  const thresholdMinutes =
    ESCALATION_CONFIG.STALLED_THRESHOLD_MINUTES[severity];

  const stalledDurationMs = Date.now() - new Date(stalledAt).getTime();
  const stalledMinutes = Math.floor(stalledDurationMs / 60000);

  if (stalledMinutes >= thresholdMinutes) {
    return {
      shouldEscalate: true,
      severity,
      reason: `Pipeline stalled at step ${step} for ${stalledMinutes} minutes (threshold: ${thresholdMinutes})`,
    };
  }

  return {
    shouldEscalate: false,
    severity,
    reason: null,
  };
};

/**
 * Determine if DLQ should be escalated based on queue depth.
 *
 * @param {number} dlqJobCount - Number of jobs in DLQ
 * @returns {object} { shouldEscalate: boolean, severity: string, reason: string }
 */
export const shouldEscalateDLQ = (dlqJobCount) => {
  if (dlqJobCount >= ESCALATION_CONFIG.DLQ_JOB_THRESHOLD) {
    return {
      shouldEscalate: true,
      severity: "HIGH",
      reason: `${dlqJobCount} jobs in Dead Letter Queue (threshold: ${ESCALATION_CONFIG.DLQ_JOB_THRESHOLD})`,
    };
  }

  return {
    shouldEscalate: false,
    severity: null,
    reason: null,
  };
};

/**
 * Determine if failure rate threshold has been exceeded.
 *
 * @param {string} step - Pipeline step
 * @param {number} totalJobs - Total jobs in last hour
 * @param {number} failedJobs - Failed jobs in last hour
 * @returns {object} { shouldEscalate: boolean, severity: string, reason: string }
 */
export const shouldEscalateFailureRate = (step, totalJobs, failedJobs) => {
  if (totalJobs === 0) {
    return { shouldEscalate: false, severity: null, reason: null };
  }

  const failureRate = (failedJobs / totalJobs) * 100;

  if (failureRate >= ESCALATION_CONFIG.FAILURE_RATE_THRESHOLD) {
    const severity = STEP_SEVERITY[step] || "MEDIUM";
    return {
      shouldEscalate: true,
      severity,
      reason: `Step ${step} has ${failureRate.toFixed(1)}% failure rate in last hour (threshold: ${ESCALATION_CONFIG.FAILURE_RATE_THRESHOLD}%)`,
    };
  }

  return {
    shouldEscalate: false,
    severity: null,
    reason: null,
  };
};

// =============================================================================
// ESCALATION ACTION FUNCTIONS
// =============================================================================

/**
 * Execute escalation for a step failure.
 * Sends notifications to super admins and creates audit log.
 *
 * @param {object} params
 * @param {string} params.orderId
 * @param {string} params.step
 * @param {number} params.retryCount
 * @param {Error} params.error
 * @param {string} params.severity
 * @param {string} params.reason
 */
export const escalateStepFailure = async ({
  orderId,
  step,
  retryCount,
  error,
  severity,
  reason,
}) => {
  logger.warn({
    msg: "Escalating step failure",
    orderId,
    step,
    retryCount,
    severity,
    reason,
    error: error.message,
  });

  // Get order details for context
  const order = await prisma.cardOrder.findUnique({
    where: { id: orderId },
    select: {
      order_number: true,
      school_id: true,
      school: {
        select: { name: true },
      },
    },
  });

  // Get all active super admins
  const superAdmins = await prisma.superAdmin.findMany({
    where: { is_active: true },
    select: { id: true, email: true, name: true },
  });

  // Send notification to each super admin
  for (const admin of superAdmins) {
    await publishNotification(
      NOTIFICATION_EVENTS.STEP_FAILURE_ESCALATED,
      orderId,
      admin.id,
      "SUPER_ADMIN",
      {
        orderNumber: order?.order_number || "N/A",
        schoolName: order?.school?.name || "N/A",
        step,
        retryCount,
        error: error.message,
        severity,
        reason,
        timestamp: new Date().toISOString(),
      },
      `step_failure:${orderId}:${step}:${admin.id}`,
    );
  }

  // Create escalation audit log
  await prisma.auditLog.create({
    data: {
      school_id: order?.school_id,
      actor_id: "system",
      actor_type: "SYSTEM",
      action: "STEP_FAILURE_ESCALATED",
      entity: "CardOrder",
      entity_id: orderId,
      new_value: {
        step,
        retryCount,
        severity,
        reason,
        error: error.message,
        timestamp: new Date().toISOString(),
      },
    },
  });

  // Store escalation in Redis for monitoring
  const escalationKey = `orch:escalation:${orderId}:${step}`;
  await redis.hset(escalationKey, {
    escalated_at: Date.now(),
    severity,
    reason,
    retry_count: retryCount,
  });
  await redis.expire(escalationKey, 86400 * 7); // 7 days
};

/**
 * Execute escalation for a stalled pipeline.
 *
 * @param {object} params
 * @param {string} params.orderId
 * @param {string} params.step
 * @param {Date} params.stalledAt
 * @param {string} params.severity
 * @param {string} params.reason
 */
export const escalateStalledPipeline = async ({
  orderId,
  step,
  stalledAt,
  severity,
  reason,
}) => {
  logger.warn({
    msg: "Escalating stalled pipeline",
    orderId,
    step,
    stalledAt,
    severity,
    reason,
  });

  const order = await prisma.cardOrder.findUnique({
    where: { id: orderId },
    select: {
      order_number: true,
      school_id: true,
      school: { select: { name: true } },
    },
  });

  const superAdmins = await prisma.superAdmin.findMany({
    where: { is_active: true },
    select: { id: true, email: true },
  });

  const stalledMinutes = Math.floor(
    (Date.now() - new Date(stalledAt).getTime()) / 60000,
  );

  for (const admin of superAdmins) {
    await publishNotification(
      NOTIFICATION_EVENTS.STALLED_PIPELINE,
      orderId,
      admin.id,
      "SUPER_ADMIN",
      {
        orderNumber: order?.order_number || "N/A",
        schoolName: order?.school?.name || "N/A",
        step,
        stalledMinutes,
        stalledAt: stalledAt.toISOString(),
        severity,
        reason,
      },
      `stalled:${orderId}:${step}:${admin.id}`,
    );
  }

  await prisma.auditLog.create({
    data: {
      school_id: order?.school_id,
      actor_id: "system",
      actor_type: "SYSTEM",
      action: "PIPELINE_STALLED_ESCALATED",
      entity: "CardOrder",
      entity_id: orderId,
      new_value: {
        step,
        stalledMinutes,
        stalledAt,
        severity,
        reason,
      },
    },
  });
};

/**
 * Execute escalation for DLQ.
 *
 * @param {object} params
 * @param {number} params.dlqJobCount
 * @param {Array} params.dlqJobs - Sample of DLQ jobs
 */
export const escalateDLQ = async ({ dlqJobCount, dlqJobs = [] }) => {
  logger.warn({
    msg: "Escalating DLQ",
    dlqJobCount,
    sampleJobs: dlqJobs.slice(0, 5),
  });

  const superAdmins = await prisma.superAdmin.findMany({
    where: { is_active: true },
    select: { id: true, email: true },
  });

  for (const admin of superAdmins) {
    await publishNotification(
      NOTIFICATION_EVENTS.DLQ_ALERT,
      null, // No orderId for global DLQ alert
      admin.id,
      "SUPER_ADMIN",
      {
        dlqJobCount,
        sampleJobs: JSON.stringify(dlqJobs.slice(0, 3)),
        timestamp: new Date().toISOString(),
      },
      `dlq_alert:${Date.now()}:${admin.id}`,
    );
  }
};

// =============================================================================
// ESCALATION MONITORING (Called by background jobs)
// =============================================================================

/**
 * Check all pipelines for stalled ones and escalate if needed.
 * Called by stalledPipeline.job.js on a schedule (e.g., every 5 minutes).
 */
export const monitorStalledPipelines = async () => {
  const stalledPipelines = await prisma.orderPipeline.findMany({
    where: {
      is_stalled: true,
      stalled_at: { not: null },
      completed_at: null,
    },
    include: {
      order: {
        select: {
          order_number: true,
          school_id: true,
        },
      },
    },
  });

  const escalatedPipelines = [];

  for (const pipeline of stalledPipelines) {
    const { shouldEscalate, severity, reason } = shouldEscalateStalledPipeline(
      pipeline.current_step,
      pipeline.stalled_at,
    );

    if (shouldEscalate) {
      await escalateStalledPipeline({
        orderId: pipeline.order_id,
        step: pipeline.current_step,
        stalledAt: pipeline.stalled_at,
        severity,
        reason,
      });
      escalatedPipelines.push(pipeline.order_id);
    }
  }

  return {
    totalStalled: stalledPipelines.length,
    escalated: escalatedPipelines.length,
    escalatedOrders: escalatedPipelines,
  };
};

/**
 * Monitor failure rates for each step type and escalate if thresholds exceeded.
 */
export const monitorFailureRates = async () => {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  const steps = Object.keys(STEP_SEVERITY);
  const escalations = [];

  for (const step of steps) {
    // Count total and failed jobs in last hour
    const totalJobs = await prisma.jobExecution.count({
      where: {
        job_name: { contains: step },
        queued_at: { gte: oneHourAgo },
      },
    });

    const failedJobs = await prisma.jobExecution.count({
      where: {
        job_name: { contains: step },
        status: "FAILED",
        queued_at: { gte: oneHourAgo },
      },
    });

    const { shouldEscalate, severity, reason } = shouldEscalateFailureRate(
      step,
      totalJobs,
      failedJobs,
    );

    if (shouldEscalate) {
      // Get sample of failed jobs
      const failedJobSamples = await prisma.jobExecution.findMany({
        where: {
          job_name: { contains: step },
          status: "FAILED",
          queued_at: { gte: oneHourAgo },
        },
        take: 5,
        select: {
          id: true,
          order_id: true,
          last_error: true,
        },
      });

      await escalateStepFailure({
        orderId: null, // No specific order
        step,
        retryCount: 0,
        error: new Error(reason),
        severity,
        reason: `${reason}. Total: ${totalJobs}, Failed: ${failedJobs}`,
      });

      escalations.push({
        step,
        severity,
        totalJobs,
        failedJobs,
        failureRate: (failedJobs / totalJobs) * 100,
        samples: failedJobSamples,
      });
    }
  }

  return escalations;
};
