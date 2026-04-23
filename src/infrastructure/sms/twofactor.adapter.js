// infrastructure/sms/twofactor.adapter.js — RESQID
import axios from 'axios';
import { SmsProvider } from './sms.provider.js';
import { logger } from '#config/logger.js';

export class TwoFactorAdapter extends SmsProvider {
  constructor(config = {}) {
    super();
    this.apiKey = config.API_KEY ?? process.env.TWOFACTOR_API_KEY;
    this.baseUrl = 'https://2factor.in/API/V1';
  }

  async sendOtp(phoneNumber, otp) {
    try {
      // Strip country code, 2Factor wants plain 10-digit number
      const phone = phoneNumber.replace(/^\+?91/, '').replace(/\D/g, '');
      console.log('[DEBUG] Raw phone:', phoneNumber, '→ Stripped:', phone);

      const response = await axios.get(`${this.baseUrl}/${this.apiKey}/SMS/${phone}/${otp}`);

      if (response.data?.Status !== 'Success') {
        throw new Error(response.data?.Details || 'Unknown error');
      }

      logger.info({ phone: phone.slice(0, 5) + '…' }, '[SMS] OTP sent via 2Factor');
      return { success: true, sessionId: response.data.Details };
    } catch (err) {
      logger.error({ error: err.response?.data || err.message }, '[SMS] 2Factor OTP send failed');
      return { success: false, error: err.message };
    }
  }

  // 2Factor verify — optional, since you own OTP logic in Redis
  async verifyOtp(sessionId, otp) {
    try {
      const response = await axios.get(
        `${this.baseUrl}/${this.apiKey}/SMS/VERIFY/${sessionId}/${otp}`
      );
      return { success: response.data?.Details === 'OTP Matched' };
    } catch (err) {
      logger.error({ error: err.message }, '[SMS] 2Factor OTP verify failed');
      return { success: false, error: err.message };
    }
  }

  // Not needed for OTP-only use, but satisfies interface
  async send(phoneNumber, message, options = {}) {
    logger.warn(
      { phone: phoneNumber?.slice(0, 6) + '…' },
      '[SMS] Transactional SMS skipped — DLT registration pending'
    );
    return { success: false, error: 'DLT registration pending' };
  }

  async sendBulk(messages) {
    throw new Error('2Factor adapter is OTP-only.');
  }

  async getStatus(messageId) {
    throw new Error('2Factor adapter does not support status checks.');
  }
}

export default TwoFactorAdapter;
