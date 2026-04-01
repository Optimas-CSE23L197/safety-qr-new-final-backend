// =============================================================================
// orchestrator/state/order.transitions.js — RESQID PRODUCTION
// Valid state transition map aligned with Prisma OrderStatus enum.
// =============================================================================

import { ORDER_STATUS, ACTIVE_STATES } from './order.states.js';

const S = ORDER_STATUS;

// Build the transition map — matches actual workflow:
// PENDING → CONFIRMED → PAYMENT_PENDING → ADVANCE_RECEIVED → TOKEN_GENERATED →
// CARD_DESIGN → CARD_DESIGN_READY → DESIGN_APPROVED → SENT_TO_VENDOR →
// PRINTING → PRINT_COMPLETE → SHIPPED → DELIVERED → BALANCE_PENDING → COMPLETED
const _transitions = new Map([
  // Order creation flow
  [S.PENDING, new Set([S.CONFIRMED, S.CANCELLED])],
  [S.CONFIRMED, new Set([S.PAYMENT_PENDING, S.CANCELLED])],
  [S.PAYMENT_PENDING, new Set([S.ADVANCE_RECEIVED, S.CANCELLED])],
  [S.ADVANCE_RECEIVED, new Set([S.TOKEN_GENERATED, S.CANCELLED])],

  // Token & Design flow
  [S.TOKEN_GENERATED, new Set([S.CARD_DESIGN, S.CANCELLED])],
  [S.CARD_DESIGN, new Set([S.CARD_DESIGN_READY, S.CARD_DESIGN_REVISION, S.CANCELLED])],
  [S.CARD_DESIGN_REVISION, new Set([S.CARD_DESIGN, S.CARD_DESIGN_READY, S.CANCELLED])],
  [S.CARD_DESIGN_READY, new Set([S.DESIGN_APPROVED, S.CANCELLED])],
  [S.DESIGN_APPROVED, new Set([S.SENT_TO_VENDOR, S.CANCELLED])],

  // Vendor & Printing flow
  [S.SENT_TO_VENDOR, new Set([S.PRINTING, S.CANCELLED])],
  [S.PRINTING, new Set([S.PRINT_COMPLETE, S.CANCELLED])],
  [S.PRINT_COMPLETE, new Set([S.READY_TO_SHIP, S.CANCELLED])],

  // Shipment flow
  [S.READY_TO_SHIP, new Set([S.SHIPPED, S.CANCELLED])],
  [S.SHIPPED, new Set([S.OUT_FOR_DELIVERY, S.DELIVERED, S.CANCELLED])],
  [S.OUT_FOR_DELIVERY, new Set([S.DELIVERED, S.CANCELLED])],
  [S.DELIVERED, new Set([S.BALANCE_PENDING, S.CANCELLED])],

  // Payment completion
  [S.BALANCE_PENDING, new Set([S.COMPLETED, S.CANCELLED])],

  // Terminal states
  [S.COMPLETED, new Set([])],
  [S.CANCELLED, new Set([S.REFUNDED])],
  [S.REFUNDED, new Set([])],
  [S.ON_HOLD, new Set([...Object.values(S).filter(s => s !== S.CANCELLED && s !== S.REFUNDED)])],
]);

// Every active state can go to CANCELLED or ON_HOLD (already covered above)
for (const state of ACTIVE_STATES) {
  if (!_transitions.has(state)) {
    _transitions.set(state, new Set([S.CANCELLED, S.ON_HOLD]));
  } else {
    const existing = _transitions.get(state);
    existing.add(S.CANCELLED);
    existing.add(S.ON_HOLD);
    _transitions.set(state, existing);
  }
}

// Freeze the outer map (values are Sets — freeze their contents too)
for (const [, set] of _transitions) Object.freeze(set);

export const TRANSITIONS = Object.freeze(_transitions);
