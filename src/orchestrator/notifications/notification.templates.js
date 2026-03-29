// =============================================================================
// orchestrator/notifications/templates.js — RESQID
// All SMS / email / push message templates in one place.
// =============================================================================

export const smsTemplates = Object.freeze({
  OTP_LOGIN: ({ otp, expiryMinutes = 5 }) =>
    `Your ResQID login OTP is ${otp}. Valid for ${expiryMinutes} minutes. Do not share this code.`,

  OTP_REGISTER: ({ otp, expiryMinutes = 5 }) =>
    `Your ResQID registration OTP is ${otp}. Valid for ${expiryMinutes} minutes. Do not share.`,

  EMERGENCY_ALERT: ({ studentName, schoolName, scannedAt }) =>
    `ALERT: ${studentName}'s ResQID card scanned at ${schoolName} at ${scannedAt}. Check app.`,

  ORDER_SHIPPED: ({ orderNumber, trackingId }) =>
    `ResQID: Order #${orderNumber} shipped. Tracking ID: ${trackingId}.`,

  ORDER_DELIVERED: ({ orderNumber }) =>
    `ResQID: Order #${orderNumber} delivered. Activate cards via dashboard.`,

  STUDENT_CARD_EXPIRING: ({ studentName, expiryDate }) =>
    `ResQID: ${studentName}'s ID card expires on ${expiryDate}. Renew soon.`,

  STALLED_PIPELINE_ALERT: ({ orderNumber, step, elapsedMin }) =>
    `ResQID ALERT: Order #${orderNumber} stalled at "${step}" for ${elapsedMin} min.`,
});

export const pushTemplates = Object.freeze({
  EMERGENCY_ALERT: ({ studentName, schoolName }) => ({
    title: 'Emergency Alert',
    body: `${studentName}'s card scanned at ${schoolName}.`,
  }),

  ORDER_CONFIRMED: ({ orderNumber }) => ({
    title: 'Order Confirmed',
    body: `Order #${orderNumber} confirmed.`,
  }),

  PARTIAL_PAYMENT_CONFIRMED: ({ orderNumber, amount }) => ({
    title: 'Partial Payment Confirmed',
    body: `₹${amount} received for order #${orderNumber}.`,
  }),

  PARTIAL_INVOICE_GENERATED: ({ orderNumber, amount }) => ({
    title: 'Partial Invoice Generated',
    body: `Invoice of ₹${amount} created for order #${orderNumber}.`,
  }),

  ORDER_TOKEN_GENERATION_COMPLETE: ({ orderNumber }) => ({
    title: 'Token Generation Complete',
    body: `Order #${orderNumber}: QR codes generated.`,
  }),

  ORDER_CARD_DESIGN_COMPLETE: ({ orderNumber }) => ({
    title: 'Card Design Ready',
    body: `Order #${orderNumber} design complete. Review now.`,
  }),

  DESIGN_APPROVED: ({ orderNumber }) => ({
    title: 'Design Approved',
    body: `Order #${orderNumber} approved. Printing next.`,
  }),

  ORDER_SHIPPED: ({ orderNumber, trackingId }) => ({
    title: 'Order Shipped',
    body: `Order #${orderNumber} shipped. Tracking: ${trackingId}`,
  }),

  ORDER_DELIVERED: ({ orderNumber }) => ({
    title: 'Order Delivered',
    body: `Order #${orderNumber} delivered.`,
  }),

  ORDER_BALANCE_INVOICE: ({ orderNumber, amount }) => ({
    title: 'Balance Invoice Due',
    body: `₹${amount} due for order #${orderNumber}.`,
  }),

  REFUNDED: ({ orderNumber, amount }) => ({
    title: 'Order Refunded',
    body: `Order #${orderNumber} refunded. Amount: ₹${amount}.`,
  }),
});

const emailBase = content => `<!DOCTYPE html>...${content}...`; // unchanged base

export const emailTemplates = Object.freeze({
  ORDER_CONFIRMED: ({ schoolName, orderNumber, cardCount, amount }) => ({
    subject: `Order Confirmed — #${orderNumber}`,
    html: emailBase(`
      <p>Dear ${schoolName},</p>
      <p>Your order #${orderNumber} confirmed.</p>
      <div><strong>Cards</strong> ${cardCount}</div>
      <div><strong>Advance Amount</strong> ₹${amount}</div>
    `),
  }),

  PARTIAL_PAYMENT_CONFIRMED: ({ schoolName, orderNumber, amount }) => ({
    subject: `Partial Payment Confirmed — #${orderNumber}`,
    html: emailBase(`
      <p>Dear ${schoolName},</p>
      <p>Partial payment of ₹${amount} received for order #${orderNumber}.</p>
    `),
  }),

  PARTIAL_INVOICE_GENERATED: ({ schoolName, orderNumber, amount, invoiceUrl }) => ({
    subject: `Partial Invoice Generated — #${orderNumber}`,
    html: emailBase(`
      <p>Dear ${schoolName},</p>
      <p>Invoice of ₹${amount} generated for order #${orderNumber}.</p>
      ${invoiceUrl ? `<a href="${invoiceUrl}" class="btn">View Invoice</a>` : ''}
    `),
  }),

  DESIGN_APPROVED: ({ schoolName, orderNumber }) => ({
    subject: `Design Approved — #${orderNumber}`,
    html: emailBase(`
      <p>Dear ${schoolName},</p>
      <p>Card design for order #${orderNumber} approved. Printing will begin.</p>
    `),
  }),

  REFUNDED: ({ schoolName, orderNumber, amount }) => ({
    subject: `Order Refunded — #${orderNumber}`,
    html: emailBase(`
      <p>Dear ${schoolName},</p>
      <p>Order #${orderNumber} refunded. Amount: ₹${amount}.</p>
    `),
  }),

  // existing templates unchanged...
});
