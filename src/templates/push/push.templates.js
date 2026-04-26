// =============================================================================
// src/templates/push/push.templates.js — RESQID
// Expo push notification templates
// Emergency-first, guardian-focused — clear, calm, actionable
// =============================================================================

export const pushTemplates = Object.freeze({
  // ── Emergency ────────────────────────────────────────────────────────
  EMERGENCY_ALERT: ({ studentName, location }) => ({
    title: '🚨 Emergency Alert',
    body: `${studentName}'s safety profile was accessed at ${location || 'an unknown location'}. Open the app immediately.`,
    data: { type: 'EMERGENCY', priority: 'critical' },
  }),

  // ── Order Lifecycle ──────────────────────────────────────────────────
  ORDER_CONFIRMED: ({ orderNumber }) => ({
    title: 'Order Confirmed',
    body: `Order #${orderNumber} has been confirmed. We'll keep you updated.`,
  }),

  ORDER_ADVANCE_PAYMENT_RECEIVED: ({ orderNumber, amount }) => ({
    title: 'Payment Received',
    body: `Advance payment of Rs.${amount} received for order #${orderNumber}.`,
  }),

  PARTIAL_PAYMENT_CONFIRMED: ({ orderNumber, amount }) => ({
    title: 'Payment Confirmed',
    body: `Payment of Rs.${amount} received for order #${orderNumber}.`,
  }),

  PARTIAL_INVOICE_GENERATED: ({ orderNumber, amount }) => ({
    title: 'Invoice Generated',
    body: `Invoice of Rs.${amount} has been generated for order #${orderNumber}.`,
  }),

  ORDER_TOKEN_GENERATION_COMPLETE: ({ orderNumber }) => ({
    title: 'QR Codes Ready',
    body: `Order #${orderNumber}: All safety profile QR codes have been generated.`,
  }),

  ORDER_CARD_DESIGN_COMPLETE: ({ orderNumber }) => ({
    title: 'Design Ready for Review',
    body: `Order #${orderNumber} card designs are complete. Please review and approve.`,
  }),

  DESIGN_APPROVED: ({ orderNumber }) => ({
    title: 'Design Approved',
    body: `Order #${orderNumber} design has been approved. Production begins shortly.`,
  }),

  ORDER_SHIPPED: ({ orderNumber, trackingId }) => ({
    title: 'Order Shipped',
    body: `Order #${orderNumber} is on its way. Tracking ID: ${trackingId || 'will be shared soon'}.`,
  }),

  ORDER_DELIVERED: ({ orderNumber }) => ({
    title: 'Order Delivered',
    body: `Order #${orderNumber} has been delivered. Cards are ready to activate.`,
  }),

  ORDER_BALANCE_INVOICE: ({ orderNumber, amount }) => ({
    title: 'Balance Payment Due',
    body: `Outstanding balance of Rs.${amount} is due for order #${orderNumber}.`,
  }),

  ORDER_REFUNDED: ({ orderNumber, amount }) => ({
    title: 'Refund Processed',
    body: `A refund of Rs.${amount} has been initiated for order #${orderNumber}.`,
  }),

  // ── Student / Cardholder ─────────────────────────────────────────────
  STUDENT_CARD_EXPIRING: ({ studentName, daysLeft }) => ({
    title: 'Profile Expiring Soon',
    body: `${studentName}'s safety profile card expires in ${daysLeft} day(s). Renew to keep protection active.`,
  }),

  STUDENT_QR_SCANNED: ({ studentName, location }) => ({
    title: 'Profile Accessed',
    body: `${studentName}'s safety profile was accessed${location ? ` at ${location}` : ''}. Tap for details.`,
  }),

  // ── Parent / Guardian Actions ────────────────────────────────────────
  PARENT_CARD_LINKED: ({ studentName }) => ({
    title: 'Profile Linked ✅',
    body: `${studentName}'s safety profile is now linked to your account. You're all set.`,
  }),

  PARENT_CARD_LOCKED: ({ studentName }) => ({
    title: 'Profile Locked 🔒',
    body: `${studentName}'s safety profile has been locked. If this wasn't you, take action now.`,
  }),

  PARENT_CHILD_UNLINKED: ({ studentName }) => ({
    title: 'Profile Removed',
    body: `${studentName}'s safety profile has been removed from your account.`,
  }),

  // ── Anomaly ──────────────────────────────────────────────────────────
  ANOMALY_DETECTED: ({ studentName, anomalyType }) => ({
    title: '⚠️ Unusual Activity',
    body: `${anomalyType} activity detected on ${studentName}'s safety profile. Tap to review.`,
    data: { type: 'ANOMALY', priority: 'high' },
  }),
});
