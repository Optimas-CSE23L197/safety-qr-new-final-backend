// =============================================================================
// orchestrator/notifications/notification.templates.js — RESQID
//
// This file is the bridge between the dispatcher and the templates folder.
// All actual template content lives in src/templates/.
// When you add a React Mail / HTML template, update src/templates/ only —
// this file just re-exports / wraps them for the dispatcher to call.
//
// SHAPE CONTRACT:
//   smsTemplates.KEY(vars)   → string
//   pushTemplates.KEY(vars)  → { title, body }
//   emailTemplates.KEY(vars) → { subject, html }
// =============================================================================

// ---------------------------------------------------------------------------
// SMS Templates
// Thin wrappers — replace bodies with imports from src/templates/sms/ once
// your DLT-registered templates are finalised.
// ---------------------------------------------------------------------------
export const smsTemplates = Object.freeze({
  OTP_LOGIN: ({ otp, expiryMinutes = 5 }) =>
    `Your ResQID login OTP is ${otp}. Valid for ${expiryMinutes} minutes. Do not share.`,

  OTP_REGISTER: ({ otp, expiryMinutes = 5 }) =>
    `Your ResQID registration OTP is ${otp}. Valid for ${expiryMinutes} minutes. Do not share.`,

  EMERGENCY_ALERT: ({ studentName, schoolName, scannedAt }) =>
    `ALERT: ${studentName}'s ResQID card scanned at ${schoolName} at ${scannedAt}. Check app immediately.`,

  ORDER_SHIPPED: ({ orderNumber, trackingId }) =>
    `ResQID: Order #${orderNumber} shipped. Tracking ID: ${trackingId}.`,

  ORDER_DELIVERED: ({ orderNumber }) =>
    `ResQID: Order #${orderNumber} delivered. Activate cards via your dashboard.`,

  STUDENT_CARD_EXPIRING: ({ studentName, expiryDate }) =>
    `ResQID: ${studentName}'s ID card expires on ${expiryDate}. Renew soon to stay protected.`,

  BALANCE_INVOICE_DUE: ({ orderNumber, amount }) =>
    `ResQID: Balance of Rs.${amount} due for order #${orderNumber}. Please clear to complete delivery.`,

  STALLED_PIPELINE_ALERT: ({ orderNumber, step, elapsedMin }) =>
    `ResQID ALERT: Order #${orderNumber} stalled at "${step}" for ${elapsedMin} min.`,
});

// ---------------------------------------------------------------------------
// Push Templates
// All Expo-compatible — { title, body } only. No FCM-specific fields.
// ---------------------------------------------------------------------------
export const pushTemplates = Object.freeze({
  EMERGENCY_ALERT: ({ studentName, schoolName }) => ({
    title: 'Emergency Alert',
    body: `${studentName}'s card scanned at ${schoolName}. Open app now.`,
  }),

  ORDER_CONFIRMED: ({ orderNumber }) => ({
    title: 'Order Confirmed',
    body: `Order #${orderNumber} has been confirmed.`,
  }),

  ORDER_ADVANCE_PAYMENT_RECEIVED: ({ orderNumber, amount }) => ({
    title: 'Advance Payment Received',
    body: `Rs.${amount} received for order #${orderNumber}.`,
  }),

  PARTIAL_PAYMENT_CONFIRMED: ({ orderNumber, amount }) => ({
    title: 'Partial Payment Confirmed',
    body: `Rs.${amount} received for order #${orderNumber}.`,
  }),

  PARTIAL_INVOICE_GENERATED: ({ orderNumber, amount }) => ({
    title: 'Partial Invoice Generated',
    body: `Invoice of Rs.${amount} created for order #${orderNumber}.`,
  }),

  ORDER_TOKEN_GENERATION_COMPLETE: ({ orderNumber }) => ({
    title: 'Token Generation Complete',
    body: `Order #${orderNumber}: QR codes generated successfully.`,
  }),

  ORDER_CARD_DESIGN_COMPLETE: ({ orderNumber }) => ({
    title: 'Card Design Ready',
    body: `Order #${orderNumber} design is complete. Please review.`,
  }),

  DESIGN_APPROVED: ({ orderNumber }) => ({
    title: 'Design Approved',
    body: `Order #${orderNumber} design approved. Printing begins shortly.`,
  }),

  ORDER_SHIPPED: ({ orderNumber, trackingId }) => ({
    title: 'Order Shipped',
    body: `Order #${orderNumber} shipped. Tracking: ${trackingId}`,
  }),

  ORDER_DELIVERED: ({ orderNumber }) => ({
    title: 'Order Delivered',
    body: `Order #${orderNumber} has been delivered.`,
  }),

  ORDER_BALANCE_INVOICE: ({ orderNumber, amount }) => ({
    title: 'Balance Invoice Due',
    body: `Rs.${amount} balance due for order #${orderNumber}.`,
  }),

  ORDER_COMPLETED: ({ orderNumber }) => ({
    title: 'Order Completed',
    body: `Order #${orderNumber} is fully complete.`,
  }),

  ORDER_REFUNDED: ({ orderNumber, amount }) => ({
    title: 'Order Refunded',
    body: `Order #${orderNumber} refunded. Amount: Rs.${amount}.`,
  }),

  STUDENT_CARD_EXPIRING: ({ studentName, daysLeft }) => ({
    title: 'Card Expiring Soon',
    body: `${studentName}'s ResQID card expires in ${daysLeft} day(s). Renew now.`,
  }),

  STUDENT_QR_SCANNED: ({ studentName, location }) => ({
    title: 'QR Code Scanned',
    body: `${studentName}'s ResQID card was just scanned${location ? ` at ${location}` : ''}.`,
  }),
});

// ---------------------------------------------------------------------------
// Email Templates
// Each function returns { subject, html }.
// Replace the html values with your React Mail / SES template renders
// once finalised. The dispatcher calls these — never inline HTML here.
//
// STUB NOTICE: These are plain HTML stubs. Replace html with your
// React Mail rendered output when templates are ready.
// ---------------------------------------------------------------------------

const _wrap = (title, content) => `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1a1a1a">
<img src="https://getresqid.in/logo.png" alt="RESQID" style="height:36px;margin-bottom:24px">
${content}
<hr style="margin-top:32px;border:none;border-top:1px solid #eee">
<p style="font-size:12px;color:#888">RESQID — School Safety Platform | getresqid.in</p>
</body></html>`;

export const emailTemplates = Object.freeze({
  ORDER_CONFIRMED: ({ schoolName, orderNumber, cardCount, amount }) => ({
    subject: `Order Confirmed — #${orderNumber}`,
    html: _wrap(
      'Order Confirmed',
      `<h2>Order Confirmed</h2>
       <p>Dear ${schoolName},</p>
       <p>Your order <strong>#${orderNumber}</strong> has been confirmed.</p>
       <table style="width:100%;border-collapse:collapse;margin:16px 0">
         <tr><td style="padding:8px;background:#f9f9f9">Cards Ordered</td><td style="padding:8px"><strong>${cardCount}</strong></td></tr>
         <tr><td style="padding:8px;background:#f9f9f9">Advance Amount</td><td style="padding:8px"><strong>Rs.${amount}</strong></td></tr>
         <tr><td style="padding:8px;background:#f9f9f9">Order Number</td><td style="padding:8px"><strong>#${orderNumber}</strong></td></tr>
       </table>
       <p>You will be notified at each stage of your order.</p>`
    ),
  }),

  ORDER_ADVANCE_PAYMENT_RECEIVED: ({ schoolName, orderNumber, amount }) => ({
    subject: `Advance Payment Received — #${orderNumber}`,
    html: _wrap(
      'Advance Payment Received',
      `<h2>Payment Received</h2>
       <p>Dear ${schoolName},</p>
       <p>We have received your advance payment of <strong>Rs.${amount}</strong> for order <strong>#${orderNumber}</strong>.</p>
       <p>Your order is now in the production queue.</p>`
    ),
  }),

  PARTIAL_PAYMENT_CONFIRMED: ({ schoolName, orderNumber, amount }) => ({
    subject: `Partial Payment Confirmed — #${orderNumber}`,
    html: _wrap(
      'Partial Payment Confirmed',
      `<h2>Partial Payment Confirmed</h2>
       <p>Dear ${schoolName},</p>
       <p>Partial payment of <strong>Rs.${amount}</strong> received for order <strong>#${orderNumber}</strong>.</p>`
    ),
  }),

  PARTIAL_INVOICE_GENERATED: ({ schoolName, orderNumber, amount, invoiceUrl }) => ({
    subject: `Partial Invoice — #${orderNumber}`,
    html: _wrap(
      'Partial Invoice Generated',
      `<h2>Partial Invoice Generated</h2>
       <p>Dear ${schoolName},</p>
       <p>An invoice of <strong>Rs.${amount}</strong> has been generated for order <strong>#${orderNumber}</strong>.</p>
       ${invoiceUrl ? `<p><a href="${invoiceUrl}" style="display:inline-block;padding:10px 20px;background:#1a1a2e;color:#fff;text-decoration:none;border-radius:6px">View Invoice</a></p>` : ''}`
    ),
  }),

  ORDER_CARD_DESIGN_COMPLETE: ({ schoolName, orderNumber, reviewUrl }) => ({
    subject: `Card Design Ready for Review — #${orderNumber}`,
    html: _wrap(
      'Card Design Ready',
      `<h2>Card Design Ready</h2>
       <p>Dear ${schoolName},</p>
       <p>The card design for order <strong>#${orderNumber}</strong> is complete and ready for your review.</p>
       ${reviewUrl ? `<p><a href="${reviewUrl}" style="display:inline-block;padding:10px 20px;background:#1a1a2e;color:#fff;text-decoration:none;border-radius:6px">Review Design</a></p>` : '<p>Please log in to your dashboard to review.</p>'}`
    ),
  }),

  DESIGN_APPROVED: ({ schoolName, orderNumber }) => ({
    subject: `Design Approved — #${orderNumber}`,
    html: _wrap(
      'Design Approved',
      `<h2>Design Approved</h2>
       <p>Dear ${schoolName},</p>
       <p>The card design for order <strong>#${orderNumber}</strong> has been approved. Printing will begin shortly.</p>`
    ),
  }),

  ORDER_SHIPPED: ({ schoolName, orderNumber, trackingId, trackingUrl }) => ({
    subject: `Order Shipped — #${orderNumber}`,
    html: _wrap(
      'Order Shipped',
      `<h2>Your Order is on the Way</h2>
       <p>Dear ${schoolName},</p>
       <p>Order <strong>#${orderNumber}</strong> has been shipped.</p>
       <table style="width:100%;border-collapse:collapse;margin:16px 0">
         <tr><td style="padding:8px;background:#f9f9f9">Tracking ID</td><td style="padding:8px"><strong>${trackingId}</strong></td></tr>
       </table>
       ${trackingUrl ? `<p><a href="${trackingUrl}" style="display:inline-block;padding:10px 20px;background:#1a1a2e;color:#fff;text-decoration:none;border-radius:6px">Track Order</a></p>` : ''}`
    ),
  }),

  ORDER_DELIVERED: ({ schoolName, orderNumber }) => ({
    subject: `Order Delivered — #${orderNumber}`,
    html: _wrap(
      'Order Delivered',
      `<h2>Order Delivered</h2>
       <p>Dear ${schoolName},</p>
       <p>Order <strong>#${orderNumber}</strong> has been delivered. Please activate the cards from your dashboard.</p>`
    ),
  }),

  ORDER_BALANCE_INVOICE: ({ schoolName, orderNumber, amount, dueDate, invoiceUrl }) => ({
    subject: `Balance Invoice Due — #${orderNumber}`,
    html: _wrap(
      'Balance Invoice Due',
      `<h2>Balance Invoice</h2>
       <p>Dear ${schoolName},</p>
       <p>A balance of <strong>Rs.${amount}</strong> is due for order <strong>#${orderNumber}</strong>.</p>
       <table style="width:100%;border-collapse:collapse;margin:16px 0">
         <tr><td style="padding:8px;background:#f9f9f9">Amount Due</td><td style="padding:8px"><strong>Rs.${amount}</strong></td></tr>
         <tr><td style="padding:8px;background:#f9f9f9">Due Date</td><td style="padding:8px"><strong>${dueDate}</strong></td></tr>
       </table>
       ${invoiceUrl ? `<p><a href="${invoiceUrl}" style="display:inline-block;padding:10px 20px;background:#1a1a2e;color:#fff;text-decoration:none;border-radius:6px">View Invoice</a></p>` : ''}`
    ),
  }),

  ORDER_COMPLETED: ({ schoolName, orderNumber }) => ({
    subject: `Order Complete — #${orderNumber}`,
    html: _wrap(
      'Order Complete',
      `<h2>Order Complete</h2>
       <p>Dear ${schoolName},</p>
       <p>Order <strong>#${orderNumber}</strong> is fully complete. Thank you for choosing RESQID.</p>`
    ),
  }),

  ORDER_REFUNDED: ({ schoolName, orderNumber, amount }) => ({
    subject: `Order Refunded — #${orderNumber}`,
    html: _wrap(
      'Order Refunded',
      `<h2>Order Refunded</h2>
       <p>Dear ${schoolName},</p>
       <p>Order <strong>#${orderNumber}</strong> has been refunded. Amount: <strong>Rs.${amount}</strong>.</p>`
    ),
  }),

  SCHOOL_ONBOARDED: ({ schoolName, adminName, dashboardUrl }) => ({
    subject: `Welcome to RESQID — ${schoolName}`,
    html: _wrap(
      'Welcome to RESQID',
      `<h2>Welcome, ${adminName}!</h2>
       <p>Your school <strong>${schoolName}</strong> has been successfully onboarded to RESQID.</p>
       <p>You can now manage student safety cards, emergency profiles, and more from your dashboard.</p>
       ${dashboardUrl ? `<p><a href="${dashboardUrl}" style="display:inline-block;padding:10px 20px;background:#1a1a2e;color:#fff;text-decoration:none;border-radius:6px">Go to Dashboard</a></p>` : ''}`
    ),
  }),

  SCHOOL_RENEWAL_DUE: ({ schoolName, expiryDate, renewUrl }) => ({
    subject: `Subscription Renewal Due — ${schoolName}`,
    html: _wrap(
      'Renewal Due',
      `<h2>Subscription Renewal Due</h2>
       <p>Dear ${schoolName} Admin,</p>
       <p>Your RESQID subscription expires on <strong>${expiryDate}</strong>. Renew now to ensure uninterrupted safety coverage for your students.</p>
       ${renewUrl ? `<p><a href="${renewUrl}" style="display:inline-block;padding:10px 20px;background:#1a1a2e;color:#fff;text-decoration:none;border-radius:6px">Renew Now</a></p>` : ''}`
    ),
  }),

  USER_DEVICE_LOGIN_NEW: ({ name, device, location, time }) => ({
    subject: 'New Login Detected — RESQID',
    html: _wrap(
      'New Login Detected',
      `<h2>New Login Detected</h2>
       <p>Hello ${name},</p>
       <p>A new login to your RESQID account was detected.</p>
       <table style="width:100%;border-collapse:collapse;margin:16px 0">
         <tr><td style="padding:8px;background:#f9f9f9">Device</td><td style="padding:8px">${device ?? 'Unknown'}</td></tr>
         <tr><td style="padding:8px;background:#f9f9f9">Location</td><td style="padding:8px">${location ?? 'Unknown'}</td></tr>
         <tr><td style="padding:8px;background:#f9f9f9">Time</td><td style="padding:8px">${time}</td></tr>
       </table>
       <p>If this wasn't you, please contact support immediately.</p>`
    ),
  }),

  EMERGENCY_ALERT_LOG: ({ studentName, schoolName, location, scannedAt, dispatchResults }) => ({
    subject: `[RESQID] Emergency Alert — ${studentName}`,
    html: _wrap(
      'Emergency Alert Details',
      `<h2 style="color:#dc2626">Emergency Alert Fired</h2>
       <table style="width:100%;border-collapse:collapse;margin:16px 0">
         <tr><td style="padding:8px;background:#fef2f2">Student</td><td style="padding:8px"><strong>${studentName}</strong></td></tr>
         <tr><td style="padding:8px;background:#fef2f2">School</td><td style="padding:8px">${schoolName}</td></tr>
         <tr><td style="padding:8px;background:#fef2f2">Scanned At</td><td style="padding:8px">${scannedAt}</td></tr>
         <tr><td style="padding:8px;background:#fef2f2">Location</td><td style="padding:8px">${location?.lat && location?.lng ? `<a href="https://maps.google.com/?q=${location.lat},${location.lng}">View on Maps</a>` : 'Unknown'}</td></tr>
         <tr><td style="padding:8px;background:#fef2f2">SMS</td><td style="padding:8px">${dispatchResults?.sms?.success ? '✅ Sent' : '❌ Failed'}</td></tr>
         <tr><td style="padding:8px;background:#fef2f2">Push</td><td style="padding:8px">${dispatchResults?.push?.success ? '✅ Sent' : '❌ Failed'}</td></tr>
       </table>`
    ),
  }),
});
s