// =============================================================================
// infrastructure/sms/msg91.adapter.js — RESQID
// MSG91 adapter. DLT-compliant SMS, OTP send/verify.
// REMOVED: registerTemplate(), _renderTemplate(), sendTemplate() — dead code.
//          SMS content comes from src/templates/sms/ — never registered here.
// =============================================================================

import axios from 'axios';
import { SmsProvider } from './sms.provider.js';
import { logger } from '#config/logger.js';

export class MSG91Adapter extends SmsProvider {
  constructor(config = {}) {
    super();
    this.authKey = config.AUTH_KEY ?? process.env.MSG91_AUTH_KEY;
    this.senderId = config.SENDER_ID ?? process.env.MSG91_SENDER_ID ?? 'RESQID';
    this.templateId = config.TEMPLATE_ID ?? process.env.MSG91_TEMPLATE_ID;
    this.route = config.ROUTE ?? process.env.MSG91_ROUTE ?? '4';
    this.country = config.COUNTRY ?? process.env.MSG91_COUNTRY ?? '91';
    this.baseUrl = 'https://api.msg91.com/api/v5';
  }

  /**
   * Send a plain SMS message (DLT template optional).
   * message content always comes from src/templates/sms/ — caller renders it.
   */
  async send(phoneNumber, message, options = {}) {
    const { templateId = this.templateId } = options;

    try {
      const payload = {
        sender: this.senderId,
        mobiles: phoneNumber.replace(/\D/g, ''),
        country: this.country,
        route: this.route,
      };

      if (templateId) {
        payload.template_id = templateId;
        payload.var = message;
      } else {
        payload.message = message;
      }

      const response = await axios.post(`${this.baseUrl}/flow/`, payload, {
        headers: { authkey: this.authKey, 'Content-Type': 'application/json' },
      });

      const messageId = response.data?.message_id || response.data?.request_id;
      logger.info({ phone: phoneNumber.slice(0, 6) + '…', messageId }, '[SMS] Sent');
      return { success: true, messageId };
    } catch (err) {
      logger.error(
        { phone: phoneNumber.slice(0, 6) + '…', error: err.response?.data || err.message },
        '[SMS] Send failed'
      );
      return { success: false, error: err.message };
    }
  }

  /**
   * Send to multiple recipients in parallel.
   */
  async sendBulk(messages) {
    const results = await Promise.allSettled(
      messages.map(({ phone, message, templateId }) => this.send(phone, message, { templateId }))
    );
    return results.map((result, index) =>
      result.status === 'fulfilled'
        ? result.value
        : { success: false, error: result.reason?.message, phone: messages[index]?.phone }
    );
  }

  /**
   * Check delivery status of a sent message.
   */
  async getStatus(messageId) {
    try {
      const response = await axios.get(`${this.baseUrl}/message/${messageId}`, {
        headers: { authkey: this.authKey },
      });
      return response.data;
    } catch (err) {
      logger.error({ messageId, error: err.message }, '[SMS] Status check failed');
      return null;
    }
  }

  /**
   * Send OTP via MSG91 dedicated OTP API.
   * Uses MSG91_OTP_TEMPLATE_ID env var.
   */
  async sendOtp(phoneNumber, otp) {
    try {
      const payload = {
        template_id: process.env.MSG91_OTP_TEMPLATE_ID,
        mobile: `91${phoneNumber.replace(/\D/g, '').replace(/^91/, '')}`,
        authkey: this.authKey,
        otp,
      };

      const response = await axios.post('https://control.msg91.com/api/v5/otp', payload, {
        headers: { 'Content-Type': 'application/json' },
      });

      logger.info(
        { phone: phoneNumber.slice(0, 6) + '…', type: response.data?.type },
        '[SMS] OTP sent'
      );
      return { success: true, requestId: response.data?.request_id };
    } catch (err) {
      logger.error(
        { phone: phoneNumber.slice(0, 6) + '…', error: err.response?.data || err.message },
        '[SMS] OTP send failed'
      );
      return { success: false, error: err.message };
    }
  }

  /**
   * Verify OTP submitted by user.
   */
  async verifyOtp(phoneNumber, otp) {
    try {
      const response = await axios.get('https://control.msg91.com/api/v5/otp/verify', {
        params: {
          mobile: `91${phoneNumber.replace(/\D/g, '').replace(/^91/, '')}`,
          otp,
          authkey: this.authKey,
        },
      });
      return { success: response.data?.type === 'success' };
    } catch (err) {
      logger.error({ error: err.message }, '[SMS] OTP verify failed');
      return { success: false, error: err.message };
    }
  }
}

export default MSG91Adapter;
