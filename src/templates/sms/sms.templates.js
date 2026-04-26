// =============================================================================
// src/templates/sms/sms.templates.js — RESQID
// Emergency-first, guardian-focused SMS templates
// DLT registration pending — will register these exact messages
// =============================================================================

export const smsTemplates = Object.freeze({
  // ── OTP ──────────────────────────────────────────────────────────────
  OTP_LOGIN: ({ otp, expiryMinutes = 5 }) =>
    `Your RESQID login OTP is ${otp}. Valid for ${expiryMinutes} min. Do not share. -RESQID`,

  OTP_REGISTER: ({ otp, expiryMinutes = 5 }) =>
    `Your RESQID registration OTP is ${otp}. Valid for ${expiryMinutes} min. Do not share. -RESQID`,

  // ── Emergency ────────────────────────────────────────────────────────
  EMERGENCY_ALERT: ({ studentName, location, scannedAt }) =>
    `URGENT: ${studentName}'s safety profile was accessed at ${location || 'an unknown location'} on ${scannedAt}. Open the app immediately. -RESQID`,

  // ── Order Lifecycle ──────────────────────────────────────────────────
  ORDER_SHIPPED: ({ orderNumber, trackingId }) =>
    `RESQID: Order #${orderNumber} has been shipped. Track it here: ${trackingId}. -RESQID`,

  BALANCE_INVOICE_DUE: ({ orderNumber, amount }) =>
    `RESQID: Rs.${amount} balance is due for order #${orderNumber}. Please clear it to avoid delays. -RESQID`,

  // ── Card / Student ───────────────────────────────────────────────────
  STUDENT_CARD_EXPIRING: ({ studentName, expiryDate }) =>
    `RESQID: ${studentName}'s safety profile card will expire on ${expiryDate}. Renew now to keep protection active. -RESQID`,

  CARD_LINKED: ({ studentName }) =>
    `RESQID: ${studentName}'s safety profile is now linked to your account. -RESQID`,

  CARD_LOCKED: ({ studentName }) =>
    `RESQID: ${studentName}'s safety profile has been locked. If this wasn't you, secure your account immediately. -RESQID`,

  CARD_REPLACE_REQUESTED: ({ studentName }) =>
    `RESQID: A replacement card for ${studentName} has been requested. We'll keep you updated. -RESQID`,

  // ── Account ─────────────────────────────────────────────────────────
  ACCOUNT_DELETED: ({ parentName }) =>
    `RESQID: The account for ${parentName} has been closed. Data will be removed within 30 days. -RESQID`,

  PHONE_CHANGED: ({ newPhone }) =>
    `RESQID: The phone number on your account was changed to ${newPhone}. If this wasn't you, contact our support team immediately. -RESQID`,

  CHILD_UNLINKED: ({ studentName }) =>
    `RESQID: ${studentName}'s safety profile has been removed from your account. -RESQID`,

  RENEWAL_REQUESTED: ({ studentName }) =>
    `RESQID: A card renewal has been requested for ${studentName}. The account administrator will be notified. -RESQID`,

  ANOMALY_DETECTED: ({ studentName, anomalyType }) =>
    `SAFETY ALERT: ${anomalyType} activity detected on ${studentName}'s profile. Open the RESQID app to review. -RESQID`,

  // ── School / Admin ───────────────────────────────────────────────────
  SCHOOL_RENEWAL_DUE: ({ organizationName, expiryDate, renewUrl }) =>
    `RESQID: ${organizationName}'s subscription expires on ${expiryDate}. Renew at ${renewUrl || 'getresqid.in/renew'} to continue service. -RESQID`,

  PARENT_REGISTERED: ({ parentName }) =>
    `Welcome to RESQID, ${parentName || 'Guardian'}! Your account is ready. Stay connected to your family's safety. Download the app: getresqid.in/app -RESQID`,
});
