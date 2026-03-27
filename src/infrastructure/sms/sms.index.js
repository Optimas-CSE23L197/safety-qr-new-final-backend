import { MSG91Adapter } from './msg91.adapter.js';
import { SmsProvider } from './sms.provider.js';

// ---------------------------------------------------------------------------
// SMS Templates
// ---------------------------------------------------------------------------
export const SMS_TEMPLATES = {
  OTP: 'Your RESQID verification code is {{otp}}. Valid for 10 minutes. Do not share this code with anyone.',

  EMERGENCY_ALERT:
    "⚠️ RESQID ALERT: Your child {{studentName}}'s QR code was just scanned. Open the RESQID app for details.",

  WELCOME:
    "Welcome to RESQID! Your account is ready. Download the app to manage your child's safety profile.",

  SCAN_NOTIFICATION:
    "RESQID: Someone scanned your child's QR code at {{location}}. If this wasn't you, please review it in the app.",

  CARD_RENEWAL:
    "RESQID: Your child's safety card expires in {{days}} day(s). Renew now to ensure continued protection.",
};

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------
let smsInstance = null;

export function initializeSms(config = {}) {
  if (!smsInstance) {
    const adapter = new MSG91Adapter(config);
    for (const [name, template] of Object.entries(SMS_TEMPLATES)) {
      adapter.registerTemplate(name, template);
    }
    smsInstance = adapter;
  }
  return smsInstance;
}

export function getSms() {
  if (!smsInstance) {
    throw new Error('[SMS] Not initialized. Call initializeSms() before use.');
  }
  return smsInstance;
}

export { SmsProvider, MSG91Adapter };
