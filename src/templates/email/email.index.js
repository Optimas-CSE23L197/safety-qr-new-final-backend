// src/templates/email/email.index.js
// Central export for all React Email components

// ── Auth / OTP ────────────────────────────────────────────────────────────────
export { default as OtpAdminEmail } from './otp-admin.jsx';
export { default as OtpParentEmail } from './otp-parent.jsx';

// ── Onboarding ────────────────────────────────────────────────────────────────
export { default as WelcomeSchoolEmail } from './welcome-school.jsx';
export { default as WelcomeParentEmail } from './welcome-parent.jsx';

// ── Security ──────────────────────────────────────────────────────────────────
export { default as DeviceLoginEmail } from './device-login.jsx';
export { default as EmailChangedEmail } from './email-changed.jsx';
export { default as CardLockedEmail } from './card-locked.jsx';

// ── Orders ────────────────────────────────────────────────────────────────────
export { default as OrderConfirmedEmail } from './order-confirmed.jsx';
export { default as OrderDeliveredEmail } from './order-delivered.jsx';
export { default as OrderRefundedEmail } from './order-refunded.jsx';

// ── School ────────────────────────────────────────────────────────────────────
export { default as SchoolRenewalEmail } from './school-renewal.jsx';

// ── Safety / Alerts ───────────────────────────────────────────────────────────
export { default as AnomalyDetectedEmail } from './anomaly-detected.jsx';
export { default as EmergencyLogEmail } from './emergency-log.jsx';

// ── Parent actions ────────────────────────────────────────────────────────────
export { default as CardRenewalRequestedEmail } from './card-renewal-requested.jsx';

// ── Internal ──────────────────────────────────────────────────────────────────
export { default as InternalAlertEmail } from './internal-alert.jsx';
