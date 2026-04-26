import axios from 'axios';
import { SmsProvider } from './sms.provider.js';
import { logger } from '#config/logger.js';
import { normalizePhone } from '#shared/utils/phoneNormalize.js';

export class TwoFactorAdapter extends SmsProvider {
  constructor(config = {}) {
    super();
    this.apiKey = config.API_KEY ?? process.env.TWOFACTOR_API_KEY;
    this.baseUrl = 'https://2factor.in/API/V1';
  }

  /**
   * WARNING: verifyOtp(sessionId, otp) signature is DIFFERENT from MSG91's
   * verifyOtp(phoneNumber, otp). If switching providers, update all callers.
   */
  async sendOtp(phoneNumber, otp) {
    try {
      const normalized = normalizePhone(phoneNumber, '91');
      const phone = normalized.replace(/^91/, '');

      logger.debug({ phone: phone.slice(-4) }, '[SMS] Phone normalized for 2Factor');

      const response = await axios.get(
        `${this.baseUrl}/${this.apiKey}/SMS/${phone}/${otp}/resqid-otp-service`
      );

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

  async send(phoneNumber, message, options = {}) {
    logger.warn(
      { phone: phoneNumber?.slice(0, 6) + '…' },
      '[SMS] Transactional SMS skipped — DLT registration pending'
    );
    return { success: false, error: 'DLT registration pending' };
  }

  async sendBulk(messages) {
    logger.warn('[SMS] sendBulk not supported by 2Factor adapter');
    return [];
  }

  async getStatus(messageId) {
    logger.warn({ messageId }, '[SMS] getStatus not supported by 2Factor adapter');
    return null;
  }
}

export default TwoFactorAdapter;
