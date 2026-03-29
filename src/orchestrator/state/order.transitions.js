// =============================================================================
// orchestrator/state/order.transitions.js — RESQID PHASE 1
// Valid state transition map. Every key = from-state, value = Set of to-states.
// =============================================================================

import { ORDER_STATUS, ACTIVE_STATES } from './order.states.js';

const S = ORDER_STATUS;

// Build the transition map
const _transitions = new Map([
  [S.PENDING, new Set([S.CONFIRMED])],
  [S.CONFIRMED, new Set([S.PAYMENT_PENDING])],
  [S.PAYMENT_PENDING, new Set([S.PARTIAL_PAYMENT_CONFIRMED, S.CANCELLED])],
  [S.PARTIAL_PAYMENT_CONFIRMED, new Set([S.PARTIAL_INVOICE_GENERATED])],
  [S.PARTIAL_INVOICE_GENERATED, new Set([S.ADVANCE_RECEIVED])],
  [S.ADVANCE_RECEIVED, new Set([S.TOKEN_GENERATING])],
  [S.TOKEN_GENERATING, new Set([S.TOKEN_COMPLETE])],
  [S.TOKEN_COMPLETE, new Set([S.DESIGN_GENERATING])],
  [S.DESIGN_GENERATING, new Set([S.DESIGN_COMPLETE])],
  [S.DESIGN_COMPLETE, new Set([S.DESIGN_APPROVED])],
  [S.DESIGN_APPROVED, new Set([S.VENDOR_SENT])],
  [S.VENDOR_SENT, new Set([S.PRINTING])],
  [S.PRINTING, new Set([S.SHIPPED])],
  [S.SHIPPED, new Set([S.DELIVERED])],
  [S.DELIVERED, new Set([S.COMPLETED, S.REFUNDED])],
]);

// Every active state can go to CANCELLED or ON_HOLD
for (const state of ACTIVE_STATES) {
  const existing = _transitions.get(state) ?? new Set();
  existing.add(S.CANCELLED);
  existing.add(S.ON_HOLD);
  _transitions.set(state, existing);
}

// Freeze the outer map (values are Sets — freeze their contents too)
for (const [, set] of _transitions) Object.freeze(set);

export const TRANSITIONS = _transitions;
