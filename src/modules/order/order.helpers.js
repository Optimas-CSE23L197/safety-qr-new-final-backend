// =============================================================================
// order.helpers.js — RESQID (CLEANED)
// Removed duplicate VALID_TRANSITIONS — authoritative source is order.guards.js
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

// Statuses where cancellation is allowed
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
