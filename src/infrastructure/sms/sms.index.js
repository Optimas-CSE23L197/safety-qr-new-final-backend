import { TwoFactorAdapter } from './twofactor.adapter.js';
import { MSG91Adapter } from './msg91.adapter.js';
import { SmsProvider } from './sms.provider.js';

const ACTIVE_PROVIDER = process.env.SMS_PROVIDER ?? 'twofactor';
const ADAPTERS = {
  twofactor: TwoFactorAdapter,
  msg91: MSG91Adapter,
};

let smsInstance = null;

export function initializeSms(config = {}) {
  if (!smsInstance) {
    const ActiveAdapter = ADAPTERS[ACTIVE_PROVIDER];
    if (!ActiveAdapter) throw new Error(`[SMS] Unknown provider: ${ACTIVE_PROVIDER}`);
    smsInstance = new ActiveAdapter(config);
  }
  return smsInstance;
}

export function getSms() {
  if (!smsInstance) {
    throw new Error('[SMS] Not initialized. Call initializeSms() before use.');
  }
  return smsInstance;
}

export { SmsProvider, TwoFactorAdapter, MSG91Adapter };
