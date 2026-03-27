import { FirebaseAdapter } from './firebase.adapter.js';
import { PushProvider } from './push.provider.js';

// ---------------------------------------------------------------------------
// Notification Templates
// ---------------------------------------------------------------------------
export const NOTIFICATION_TEMPLATES = {
  EMERGENCY_SCAN: {
    title: '⚠️ Emergency Alert',
    body: "Your child's QR code has been scanned. Please check the RESQID app immediately.",
  },
  SAFETY_TIP: {
    title: 'Safety Reminder',
    body: "Keep your child's emergency contacts up to date in the RESQID app.",
  },
  CARD_EXPIRING: {
    title: 'Safety Card Expiring Soon',
    body: "Your child's RESQID card expires in {{days}} days. Please renew to maintain protection.",
  },
};

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------
let pushInstance = null;

export function initializePush(config = {}) {
  if (!pushInstance) {
    pushInstance = new FirebaseAdapter(config);
  }
  return pushInstance;
}

export function getPush() {
  if (!pushInstance) {
    throw new Error('[Push] Not initialized. Call initializePush() before use.');
  }
  return pushInstance;
}

export { PushProvider, FirebaseAdapter };
