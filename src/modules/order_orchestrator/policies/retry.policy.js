// =============================================================================
// policies/retry.policy.js
// Per-step retry configuration.
// Workers read this to get their retry settings.
// =============================================================================

/**
 * Get BullMQ job options for a given step/job type.
 * Heavier async steps get more attempts and longer backoff.
 *
 * @param {string} jobName - one of JOB_NAMES
 * @returns {object} BullMQ job options
 */
export function getRetryPolicy(jobName) {
  const POLICIES = {
    "order.token": {
      attempts: 5,
      backoff: { type: "exponential", delay: 5_000 }, // token gen is heavy — more patience
    },
    "order.card": {
      attempts: 5,
      backoff: { type: "exponential", delay: 5_000 },
    },
    "order.design": {
      attempts: 5,
      backoff: { type: "exponential", delay: 5_000 },
    },
    "notify.send": {
      attempts: 5,
      backoff: { type: "exponential", delay: 1_000 },
    },
    default: {
      attempts: 3,
      backoff: { type: "exponential", delay: 2_000 },
    },
  };

  return POLICIES[jobName] ?? POLICIES["default"];
}

/**
 * Should this step type trigger a super admin alert on DLQ?
 */
export function shouldEscalateOnDLQ(jobName) {
  const ESCALATE = new Set([
    "order.token",
    "order.card",
    "order.payment",
    "order.completion",
  ]);
  return ESCALATE.has(jobName);
}
