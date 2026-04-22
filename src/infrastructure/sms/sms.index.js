// =============================================================================
// infrastructure/sms/sms.index.js — RESQID
// MSG91 adapter singleton only.
// Templates are managed in src/templates/sms/ — NOT here.
// =============================================================================

import { MSG91Adapter } from './msg91.adapter.js';
import { SmsProvider } from './sms.provider.js';

let smsInstance = null;

export function initializeSms(config = {}) {
  if (!smsInstance) {
    smsInstance = new MSG91Adapter(config);
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
