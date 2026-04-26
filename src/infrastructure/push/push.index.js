// =============================================================================
// infrastructure/push/push.index.js — RESQID
// Expo push only. No Firebase. No FCM.
// =============================================================================

import { ExpoAdapter } from './expo.adapter.js';
import { PushProvider } from './push.provider.js';

let pushInstance = null;

export function initializePush() {
  if (!pushInstance) {
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

export function resetPush() {
  pushInstance = null;
}

export { PushProvider, ExpoAdapter };
