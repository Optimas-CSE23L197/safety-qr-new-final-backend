// =============================================================================
// order.helpers.js — RESQID
// Shared pure utilities for the order pipeline. No DB calls. No side effects.
// =============================================================================

const PRICING = {
  GOVT_STANDARD: { unit: 10000, renewal: 10000 },
  PRIVATE_STANDARD: { unit: 19900, renewal: 10000 },
  ENTERPRISE: { unit: null, renewal: null },
  FREE_PILOT: { unit: 0, renewal: 0 },
};

const GST_RATE = 0.18;

export const calculateOrderFinancials = (pricingTier, cardCount, customUnitPrice = null) => {
  const tier = PRICING[pricingTier] ?? PRICING.PRIVATE_STANDARD;
  const unitPrice = customUnitPrice ?? tier.unit ?? 0;
  const subtotal = unitPrice * cardCount;
  const taxAmount = Math.round(subtotal * GST_RATE);
  const grandTotal = subtotal + taxAmount;
  const advanceAmount = Math.round(grandTotal * 0.5);
  const balanceAmount = grandTotal - advanceAmount;
  return {
    unitPrice,
    subtotal,
    taxAmount,
    grandTotal,
    advanceAmount,
    balanceAmount,
  };
};

const VALID_TRANSITIONS = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PAYMENT_PENDING', 'CANCELLED'],
  PAYMENT_PENDING: ['ADVANCE_RECEIVED', 'CANCELLED'],
  ADVANCE_RECEIVED: ['TOKEN_GENERATION', 'CANCELLED'],
  TOKEN_GENERATION: ['TOKEN_GENERATED', 'CANCELLED'],
  TOKEN_GENERATED: ['CARD_DESIGN', 'CANCELLED'],
  CARD_DESIGN: ['CARD_DESIGN_READY', 'CARD_DESIGN_REVISION', 'CANCELLED'],
  CARD_DESIGN_REVISION: ['CARD_DESIGN', 'CANCELLED'],
  CARD_DESIGN_READY: ['SENT_TO_VENDOR', 'CANCELLED'],
  SENT_TO_VENDOR: ['PRINTING', 'CANCELLED'],
  PRINTING: ['PRINT_COMPLETE', 'CANCELLED'],
  PRINT_COMPLETE: ['READY_TO_SHIP', 'CANCELLED'],
  READY_TO_SHIP: ['SHIPPED'],
  SHIPPED: ['OUT_FOR_DELIVERY', 'DELIVERED'],
  OUT_FOR_DELIVERY: ['DELIVERED'],
  DELIVERED: ['BALANCE_PENDING'],
  BALANCE_PENDING: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: ['REFUNDED'],
  REFUNDED: [],
};

export const assertValidTransition = (fromStatus, toStatus) => {
  const allowed = VALID_TRANSITIONS[fromStatus] ?? [];
  if (!allowed.includes(toStatus)) {
    throw new Error(
      `Invalid status transition: ${fromStatus} → ${toStatus}. Allowed: [${allowed.join(', ') || 'none'}]`
    );
  }
};

const CANCELLABLE_STATUSES = new Set([
  'PENDING',
  'CONFIRMED',
  'PAYMENT_PENDING',
  'ADVANCE_RECEIVED',
  'TOKEN_GENERATION',
  'TOKEN_GENERATED',
  'CARD_DESIGN',
  'CARD_DESIGN_REVISION',
  'CARD_DESIGN_READY',
  'SENT_TO_VENDOR',
  'PRINTING',
  'PRINT_COMPLETE',
]);
export const isCancellable = status => CANCELLABLE_STATUSES.has(status);

const PAID_STATUSES = new Set([
  'ADVANCE_RECEIVED',
  'TOKEN_GENERATION',
  'TOKEN_GENERATED',
  'CARD_DESIGN',
  'CARD_DESIGN_REVISION',
  'CARD_DESIGN_READY',
  'SENT_TO_VENDOR',
  'PRINTING',
  'PRINT_COMPLETE',
]);
export const requiresRefund = status => PAID_STATUSES.has(status);

export const calculateBalanceDueDate = (deliveredAt = new Date()) => {
  const due = new Date(deliveredAt);
  due.setDate(due.getDate() + 7);
  return due;
};

export const formatPaise = paise => `₹${(paise / 100).toFixed(2)}`;
export const stripEmpty = obj =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== null && v !== undefined));
