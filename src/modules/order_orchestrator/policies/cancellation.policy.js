// =============================================================================
// policies/cancellation.policy.js
// Enforces all business rules around order cancellation.
// =============================================================================

import { runCancellationGuards } from "../state/order.guards.js";
import { getOrderState } from "../services/state.service.js";
import { canCancelFromState } from "../state/order.transitions.js";

/**
 * Evaluate whether an order can be cancelled.
 *
 * Checks:
 *  1. Current state allows cancellation (transition graph)
 *  2. No advance payment received
 *  3. No tokens generated
 *  4. Printing not started
 *  5. Not shipped
 *
 * @param {string} orderId
 * @param {object} actor   - { id, role }
 * @returns {{ allowed: boolean, reason?: string }}
 */
export async function evaluateCancellation(orderId, actor) {
  // Rule 1: Only super admin can cancel
  if (!actor || actor.role !== "SUPER_ADMIN") {
    return { allowed: false, reason: "Only Super Admin can cancel an order" };
  }

  // Rule 2: Check state machine allows it
  const currentState = await getOrderState(orderId);
  if (!canCancelFromState(currentState)) {
    return {
      allowed: false,
      reason: `Order cannot be cancelled from state: ${currentState}`,
    };
  }

  // Rule 3: Run all cancellation guards (payment, tokens, printing, shipping)
  const guardResult = await runCancellationGuards(orderId);
  if (!guardResult.pass) {
    return { allowed: false, reason: guardResult.reason };
  }

  return { allowed: true };
}
