// =============================================================================
// orchestrator/state/order.states.js — RESQID
// All OrderStatus enum values as frozen constants.
// Must stay in sync with schema.prisma OrderStatus enum.
// =============================================================================

export const ORDER_STATUS = Object.freeze({
  PENDING: 'PENDING',
  CONFIRMED: 'CONFIRMED',
  PAYMENT_PENDING: 'PAYMENT_PENDING',
  ADVANCE_RECEIVED: 'ADVANCE_RECEIVED',
  TOKEN_GENERATION: 'TOKEN_GENERATION',
  TOKEN_GENERATED: 'TOKEN_GENERATED',
  CARD_DESIGN: 'CARD_DESIGN',
  CARD_DESIGN_READY: 'CARD_DESIGN_READY',
  CARD_DESIGN_REVISION: 'CARD_DESIGN_REVISION',
  SENT_TO_VENDOR: 'SENT_TO_VENDOR',
  PRINTING: 'PRINTING',
  PRINT_COMPLETE: 'PRINT_COMPLETE',
  READY_TO_SHIP: 'READY_TO_SHIP',
  SHIPPED: 'SHIPPED',
  OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
  DELIVERED: 'DELIVERED',
  BALANCE_PENDING: 'BALANCE_PENDING',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  ON_HOLD: 'ON_HOLD',
});

// Terminal states — no further transitions allowed (except via manual override)
export const TERMINAL_STATES = new Set([ORDER_STATUS.COMPLETED, ORDER_STATUS.CANCELLED]);

// Active states — can transition to CANCELLED or ON_HOLD
export const ACTIVE_STATES = new Set(
  Object.values(ORDER_STATUS).filter(s => !TERMINAL_STATES.has(s))
);
