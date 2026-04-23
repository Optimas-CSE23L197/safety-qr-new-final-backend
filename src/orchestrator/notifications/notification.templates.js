// =============================================================================
// orchestrator/notifications/notification.templates.js — RESQID
// =============================================================================

// ── Email component imports ───────────────────────────────────────────────────
import OtpAdminEmail from '#templates/email/otp-admin.jsx';
import OtpParentEmail from '#templates/email/otp-parent.jsx';
import WelcomeSchoolEmail from '#templates/email/welcome-school.jsx';
import WelcomeParentEmail from '#templates/email/welcome-parent.jsx';

// Remaining templates — uncomment as you build them:
// import OrderConfirmedEmail  from '#templates/email/order-confirmed.jsx';
// import OrderShippedEmail    from '#templates/email/order-shipped.jsx';
// import OrderDeliveredEmail  from '#templates/email/order-delivered.jsx';
// import OrderCompletedEmail  from '#templates/email/order-completed.jsx';
// import OrderRefundedEmail   from '#templates/email/order-refunded.jsx';
// import BalanceInvoiceEmail  from '#templates/email/balance-invoice.jsx';
// import CardDesignEmail      from '#templates/email/card-design-ready.jsx';
// import DesignApprovedEmail  from '#templates/email/design-approved.jsx';
// import PartialInvoiceEmail  from '#templates/email/partial-invoice.jsx';
// import NewDeviceLoginEmail  from '#templates/email/new-device-login.jsx';
// import SchoolRenewalEmail   from '#templates/email/school-renewal.jsx';
// import EmergencyLogEmail    from '#templates/email/emergency-log.jsx';

// =============================================================================
// SMS Templates
// =============================================================================

export const smsTemplates = Object.freeze({
  OTP_LOGIN: ({ otp, expiryMinutes = 5 }) =>
    `Your ResQID login OTP is ${otp}. Valid for ${expiryMinutes} min. Do not share. -RESQID`,

  OTP_REGISTER: ({ otp, expiryMinutes = 5 }) =>
    `Your ResQID registration OTP is ${otp}. Valid for ${expiryMinutes} min. Do not share. -RESQID`,

  EMERGENCY_ALERT: ({ studentName, schoolName, scannedAt }) =>
    `ALERT: ${studentName}'s ResQID card scanned at ${schoolName} at ${scannedAt}. Check app. -RESQID`,

  ORDER_SHIPPED: ({ orderNumber, trackingId }) =>
    `ResQID: Order #${orderNumber} shipped. Tracking: ${trackingId}. -RESQID`,

  ORDER_DELIVERED: ({ orderNumber }) =>
    `ResQID: Order #${orderNumber} delivered. Activate cards from your dashboard. -RESQID`,

  STUDENT_CARD_EXPIRING: ({ studentName, expiryDate }) =>
    `ResQID: ${studentName}'s ID card expires ${expiryDate}. Renew soon. -RESQID`,

  BALANCE_INVOICE_DUE: ({ orderNumber, amount }) =>
    `ResQID: Rs.${amount} balance due for order #${orderNumber}. Clear to complete delivery. -RESQID`,

  SCHOOL_RENEWAL_DUE: ({ schoolName, expiryDate, renewUrl }) =>
    `ResQID: ${schoolName} subscription expires ${expiryDate}. Renew: ${renewUrl ?? 'getresqid.in/renew'} -RESQID`,
});

// =============================================================================
// Push Templates
// =============================================================================

export const pushTemplates = Object.freeze({
  EMERGENCY_ALERT: ({ studentName, schoolName }) => ({
    title: '🚨 Emergency Alert',
    body: `${studentName}'s card scanned at ${schoolName}. Open app now.`,
  }),

  ORDER_CONFIRMED: ({ orderNumber }) => ({
    title: 'Order Confirmed',
    body: `Order #${orderNumber} has been confirmed.`,
  }),

  ORDER_ADVANCE_PAYMENT_RECEIVED: ({ orderNumber, amount }) => ({
    title: 'Payment Received',
    body: `Rs.${amount} advance received for order #${orderNumber}.`,
  }),

  PARTIAL_PAYMENT_CONFIRMED: ({ orderNumber, amount }) => ({
    title: 'Partial Payment Confirmed',
    body: `Rs.${amount} received for order #${orderNumber}.`,
  }),

  PARTIAL_INVOICE_GENERATED: ({ orderNumber, amount }) => ({
    title: 'Invoice Generated',
    body: `Invoice of Rs.${amount} created for order #${orderNumber}.`,
  }),

  ORDER_TOKEN_GENERATION_COMPLETE: ({ orderNumber }) => ({
    title: 'QR Codes Ready',
    body: `Order #${orderNumber}: QR codes generated successfully.`,
  }),

  ORDER_CARD_DESIGN_COMPLETE: ({ orderNumber }) => ({
    title: 'Card Design Ready',
    body: `Order #${orderNumber} design is complete. Please review.`,
  }),

  DESIGN_APPROVED: ({ orderNumber }) => ({
    title: 'Design Approved',
    body: `Order #${orderNumber} approved. Printing begins shortly.`,
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
    title: 'Order Complete',
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
    body: `${studentName}'s card was scanned${location ? ` at ${location}` : ''}.`,
  }),
});

// =============================================================================
// Email Templates
// =============================================================================

export const emailTemplates = Object.freeze({
  OTP_ADMIN: ({ userName, otpCode, expiryMinutes = 5 }) => ({
    subject: `Your RESQID Verification Code`,
    Component: OtpAdminEmail,
    props: { userName, otpCode, expiryMinutes },
  }),

  OTP_PARENT: ({ userName, otpCode, expiryMinutes = 5 }) => ({
    subject: `Your RESQID Verification Code`,
    Component: OtpParentEmail,
    props: { userName: userName ?? 'Parent', otpCode, expiryMinutes },
  }),

  SCHOOL_ONBOARDED: ({
    schoolName,
    adminName,
    adminEmail,
    tempPassword,
    dashboardUrl,
    planName,
    planExpiry,
    cardCount,
  }) => ({
    subject: `Welcome to RESQID — ${schoolName}`,
    Component: WelcomeSchoolEmail,
    props: {
      schoolName,
      adminName,
      adminEmail,
      tempPassword,
      dashboardUrl,
      planName,
      planExpiry,
      cardCount,
    },
  }),

  PARENT_ONBOARDED: ({
    parentName,
    phone,
    studentName,
    studentClass,
    schoolName,
    cardId,
    appStoreUrl,
    playStoreUrl,
  }) => ({
    subject: `Welcome to RESQID — ${studentName}'s emergency ID is ready`,
    Component: WelcomeParentEmail,
    props: {
      parentName,
      phone,
      studentName,
      studentClass,
      schoolName,
      cardId,
      appStoreUrl,
      playStoreUrl,
    },
  }),

  SCHOOL_RENEWAL_DUE: ({ schoolName, expiryDate, renewUrl }) => ({
    subject: `Subscription Renewal Due — ${schoolName}`,
    Component: null, // import SchoolRenewalEmail when built
    props: { schoolName, expiryDate, renewUrl },
  }),

  ORDER_CONFIRMED: ({ schoolName, orderNumber, cardCount, amount }) => ({
    subject: `Order Confirmed — #${orderNumber}`,
    Component: null,
    props: { schoolName, orderNumber, cardCount, amount },
  }),

  ORDER_ADVANCE_PAYMENT_RECEIVED: ({ schoolName, orderNumber, amount }) => ({
    subject: `Advance Payment Received — #${orderNumber}`,
    Component: null,
    props: { schoolName, orderNumber, amount },
  }),

  PARTIAL_PAYMENT_CONFIRMED: ({ schoolName, orderNumber, amount }) => ({
    subject: `Partial Payment Confirmed — #${orderNumber}`,
    Component: null,
    props: { schoolName, orderNumber, amount },
  }),

  PARTIAL_INVOICE_GENERATED: ({ schoolName, orderNumber, amount, invoiceUrl }) => ({
    subject: `Partial Invoice — #${orderNumber}`,
    Component: null,
    props: { schoolName, orderNumber, amount, invoiceUrl },
  }),

  ORDER_CARD_DESIGN_COMPLETE: ({ schoolName, orderNumber, reviewUrl }) => ({
    subject: `Card Design Ready for Review — #${orderNumber}`,
    Component: null,
    props: { schoolName, orderNumber, reviewUrl },
  }),

  DESIGN_APPROVED: ({ schoolName, orderNumber }) => ({
    subject: `Design Approved — #${orderNumber}`,
    Component: null,
    props: { schoolName, orderNumber },
  }),

  ORDER_SHIPPED: ({ schoolName, orderNumber, trackingId, trackingUrl }) => ({
    subject: `Order Shipped — #${orderNumber}`,
    Component: null,
    props: { schoolName, orderNumber, trackingId, trackingUrl },
  }),

  ORDER_DELIVERED: ({ schoolName, orderNumber }) => ({
    subject: `Order Delivered — #${orderNumber}`,
    Component: null,
    props: { schoolName, orderNumber },
  }),

  ORDER_BALANCE_INVOICE: ({ schoolName, orderNumber, amount, dueDate, invoiceUrl }) => ({
    subject: `Balance Invoice Due — #${orderNumber}`,
    Component: null,
    props: { schoolName, orderNumber, amount, dueDate, invoiceUrl },
  }),

  ORDER_COMPLETED: ({ schoolName, orderNumber }) => ({
    subject: `Order Complete — #${orderNumber}`,
    Component: null,
    props: { schoolName, orderNumber },
  }),

  ORDER_REFUNDED: ({ schoolName, orderNumber, amount }) => ({
    subject: `Order Refunded — #${orderNumber}`,
    Component: null,
    props: { schoolName, orderNumber, amount },
  }),

  USER_DEVICE_LOGIN_NEW: ({ name, device, location, time }) => ({
    subject: 'New Login Detected — RESQID',
    Component: null,
    props: { name, device, location, time },
  }),

  EMERGENCY_ALERT_LOG: ({ studentName, schoolName, location, scannedAt, dispatchResults }) => ({
    subject: `[RESQID] Emergency Alert — ${studentName}`,
    Component: null,
    props: { studentName, schoolName, location, scannedAt, dispatchResults },
  }),
});
