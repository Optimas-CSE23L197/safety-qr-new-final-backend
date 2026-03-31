// =============================================================================
// infrastructure/push/push.index.js — RESQID
// CHANGED: FirebaseAdapter → ExpoAdapter (Expo push API, no Firebase needed)
// Everything else untouched — push.js and dispatcher are unaffected.
// =============================================================================

import { ExpoAdapter } from './expo.adapter.js';
import { PushProvider } from './push.provider.js';

// ---------------------------------------------------------------------------
// Notification Templates (kept here for legacy imports)
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
    // CHANGED: was FirebaseAdapter — Expo needs no config/service account
    pushInstance = new ExpoAdapter();
  }
  return pushInstance;
}

export function getPush() {
  if (!pushInstance) {
    throw new Error('[Push] Not initialized. Call initializePush() before use.');
  }
  return pushInstance;
}

// Keep FirebaseAdapter export so any leftover import doesn't hard-crash
// (just logs a warning). Remove once confirmed nothing else imports it.
export { PushProvider, ExpoAdapter };
