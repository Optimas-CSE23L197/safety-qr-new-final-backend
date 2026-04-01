// =============================================================================
// order.helpers.js — RESQID
// PATCH 02: Fixed VALID_TRANSITIONS to match OrderStatus enum in schema
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
  return { unitPrice, subtotal, taxAmount, grandTotal, advanceAmount, balanceAmount };
};

// FIXED: All values now match OrderStatus enum exactly
const VALID_TRANSITIONS = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PAYMENT_PENDING', 'CANCELLED'],
  PAYMENT_PENDING: ['ADVANCE_RECEIVED', 'CANCELLED'],
  ADVANCE_RECEIVED: ['TOKEN_GENERATING', 'CANCELLED'],
  TOKEN_GENERATING: ['TOKEN_COMPLETE', 'CANCELLED'],
  TOKEN_COMPLETE: ['DESIGN_GENERATING', 'CANCELLED'],
  DESIGN_GENERATING: ['DESIGN_COMPLETE', 'CANCELLED'],
  DESIGN_COMPLETE: ['DESIGN_APPROVED', 'DESIGN_GENERATING', 'CANCELLED'],
  DESIGN_APPROVED: ['VENDOR_SENT', 'CANCELLED'],
  VENDOR_SENT: ['PRINTING', 'CANCELLED'],
  PRINTING: ['PRINT_COMPLETE', 'CANCELLED'],
  PRINT_COMPLETE: ['READY_TO_SHIP', 'CANCELLED'],
  READY_TO_SHIP: ['SHIPPED'],
  SHIPPED: ['DELIVERED'],
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

// FIXED: Use actual OrderStatus enum values
const CANCELLABLE_STATUSES = new Set([
  'PENDING',
  'CONFIRMED',
  'PAYMENT_PENDING',
  'ADVANCE_RECEIVED',
  'TOKEN_GENERATING',
  'TOKEN_COMPLETE',
  'DESIGN_GENERATING',
  'DESIGN_COMPLETE',
  'DESIGN_APPROVED',
  'VENDOR_SENT',
  'PRINTING',
  'PRINT_COMPLETE',
]);
export const isCancellable = status => CANCELLABLE_STATUSES.has(status);

// Statuses where advance has been paid — cancellation requires refund
const PAID_STATUSES = new Set([
  'ADVANCE_RECEIVED',
  'TOKEN_GENERATING',
  'TOKEN_COMPLETE',
  'DESIGN_GENERATING',
  'DESIGN_COMPLETE',
  'DESIGN_APPROVED',
  'VENDOR_SENT',
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
