import { TwoFactorAdapter } from './twofactor.adapter.js';
import { SmsProvider } from './sms.provider.js';

let smsInstance = null;

export function initializeSms(config = {}) {
  if (!smsInstance) {
    smsInstance = new TwoFactorAdapter(config);
  }
  return smsInstance;
}

export function getSms() {
  if (!smsInstance) {
    throw new Error('[SMS] Not initialized. Call initializeSms() before use.');
  }
  return smsInstance;
}

export { SmsProvider, TwoFactorAdapter };
