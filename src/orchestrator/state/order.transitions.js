// =============================================================================
// state/order.transitions.js
// Defines the ONLY valid forward transitions.
// Any attempt to move outside this map is rejected by the state machine.
// =============================================================================

/**
 * Map: currentState → Set of valid nextStates
 * Terminal states (COMPLETED, CANCELLED, FAILED) have no outgoing transitions.
 */
export const VALID_TRANSITIONS = {
  CREATED: new Set(['PENDING_APPROVAL']),
  PENDING_APPROVAL: new Set(['APPROVED', 'CANCELLED']),
  APPROVED: new Set(['ADVANCE_PENDING']),
  ADVANCE_PENDING: new Set(['ADVANCE_PAID', 'CANCELLED']),
  ADVANCE_PAID: new Set(['TOKEN_GENERATED']),
  TOKEN_GENERATED: new Set(['CARD_GENERATED']),
  CARD_GENERATED: new Set(['DESIGN_DONE']),
  DESIGN_DONE: new Set(['VENDOR_ASSIGNED']),
  VENDOR_ASSIGNED: new Set(['PRINTING']),
  PRINTING: new Set(['SHIPPED']),
  SHIPPED: new Set(['DELIVERED']),
  DELIVERED: new Set(['COMPLETED']),
  COMPLETED: new Set([]), // terminal
  CANCELLED: new Set([]), // terminal
  FAILED: new Set(['CANCELLED']), // failed can be cancelled/cleaned up
};

/**
 * Validate a state transition.
 * @param {string} from  - current orchestrator state
 * @param {string} to    - desired next state
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validateTransition(from, to) {
  const allowed = VALID_TRANSITIONS[from];

  if (!allowed) {
    return { valid: false, reason: `Unknown state: ${from}` };
  }

  if (!allowed.has(to)) {
    return {
      valid: false,
      reason: `Invalid transition: ${from} → ${to}. Allowed: [${[...allowed].join(', ')}]`,
    };
  }

  return { valid: true };
}

/**
 * Is a state terminal (no further transitions possible)?
 */
export function isTerminalState(state) {
  const transitions = VALID_TRANSITIONS[state];
  return transitions !== undefined && transitions.size === 0;
}

/**
 * Can an order be cancelled from a given state?
 * Business rule: cannot cancel after advance paid / tokens generated / printing started.
 */
export function canCancelFromState(state) {
  const NON_CANCELLABLE = new Set([
    'ADVANCE_PAID',
    'TOKEN_GENERATED',
    'CARD_GENERATED',
    'DESIGN_DONE',
    'VENDOR_ASSIGNED',
    'PRINTING',
    'SHIPPED',
    'DELIVERED',
    'COMPLETED',
    'CANCELLED',
    'FAILED',
  ]);
  return !NON_CANCELLABLE.has(state);
}
