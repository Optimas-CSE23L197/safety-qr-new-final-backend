// src/templates/email/otp-parent.jsx
// Used for: Parent OTP verification (login + registration)
// Props: { userName, otpCode, expiryMinutes }

// Parent OTP reuses the same design as admin OTP.
// Re-export with parent-specific default props.
export { default } from './otp-admin.jsx';