// =============================================================================
// sms.service.js — RESQID
// Environment-aware SMS service (DEV logs only, PROD sends via MSG91/other)
// =============================================================================

import { logger } from '#config/logger.js';

const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PRODUCTION = NODE_ENV === 'production';

// SMS configuration
const SMS_CONFIG = {
  provider: process.env.SMS_PROVIDER || 'msg91', // "msg91", "twilio", 'aws-sns'
  apiKey: process.env.SMS_API_KEY,
  senderId: process.env.SMS_SENDER_ID || 'RESQID',
  templateId: process.env.SMS_TEMPLATE_ID,
  countryCode: process.env.SMS_COUNTRY_CODE || '91',
};

// Phone number validation (Indian format)
const isValidIndianPhone = phone => {
  const cleaned = String(phone).replace(/\D/g, '');
  return cleaned.length === 10 && /^[6-9]\d{9}$/.test(cleaned);
};

/**
 * Format phone number to E.164 format
 * @param {string} phone - Raw phone number
 * @returns {string} Formatted phone number
 */
export const formatPhoneNumber = phone => {
  const cleaned = String(phone).replace(/\D/g, '');
  if (cleaned.length === 10) {
    return `+${SMS_CONFIG.countryCode}${cleaned}`;
  }
  if (cleaned.length === 12 && cleaned.startsWith(SMS_CONFIG.countryCode)) {
    return `+${cleaned}`;
  }
  return phone;
};

/**
 * Send SMS via MSG91 (default provider)
 * @param {string} phone - Recipient phone number
 * @param {string} message - SMS content
 * @returns {Promise<{success: boolean, messageId?: string}>}
 */
const sendViaMsg91 = async (phone, message) => {
  // This would use MSG91 API
  // For now, simulate with placeholder
  if (!SMS_CONFIG.apiKey) {
    throw new Error('MSG91 API key not configured');
  }

  // MSG91 API endpoint
  const url = 'https://api.msg91.com/api/v5/flow/';
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      authkey: SMS_CONFIG.apiKey,
    },
    body: JSON.stringify({
      mobiles: phone.replace('+', ''),
      sender: SMS_CONFIG.senderId,
      message: message.slice(0, 160), // SMS length limit
      ...(SMS_CONFIG.templateId && { template_id: SMS_CONFIG.templateId }),
    }),
  });

  if (!response.ok) {
    throw new Error(`MSG91 API error: ${response.status}`);
  }

  const data = await response.json();
  return {
    success: true,
    messageId: data.request_id || `msg91-${Date.now()}`,
  };
};

/**
 * Send SMS via Twilio (alternative)
 */
const sendViaTwilio = async (phone, message) => {
  // Placeholder for Twilio implementation
  throw new Error('Twilio not configured');
};

/**
 * Send SMS (main entry point)
 * @param {string} phone - Recipient phone number
 * @param {string} message - SMS content (max 160 chars)
 * @returns {Promise<{success: boolean, messageId?: string, simulated?: boolean}>}
 */
export const sendSms = async (phone, message) => {
  // Validate input
  if (!phone || !message) {
    throw new Error('Missing required SMS parameters: phone, message');
  }

  // Validate phone number
  const cleanedPhone = String(phone).replace(/\D/g, '');
  if (!isValidIndianPhone(cleanedPhone) && cleanedPhone.length !== 12) {
    logger.warn({
      msg: 'Invalid phone number format',
      phone,
      cleaned: cleanedPhone,
    });
    throw new Error(`Invalid phone number: ${phone}`);
  }

  const formattedPhone = formatPhoneNumber(phone);
  const truncatedMessage = message.slice(0, 160);

  // DEVELOPMENT MODE: Log only
  if (!IS_PRODUCTION) {
    logger.info({
      msg: '[DEV] SMS would send:',
      phone: formattedPhone,
      message: truncatedMessage,
      length: truncatedMessage.length,
    });
    return {
      success: true,
      simulated: true,
      messageId: `dev-${Date.now()}`,
      phone: formattedPhone,
    };
  }

  // PRODUCTION MODE: Send real SMS
  try {
    let result;
    switch (SMS_CONFIG.provider) {
      case 'msg91':
        result = await sendViaMsg91(formattedPhone, truncatedMessage);
        break;
      case 'twilio':
        result = await sendViaTwilio(formattedPhone, truncatedMessage);
        break;
      default:
        throw new Error(`Unknown SMS provider: ${SMS_CONFIG.provider}`);
    }

    logger.info({
      msg: 'SMS sent successfully',
      phone: formattedPhone,
      messageId: result.messageId,
    });

    return result;
  } catch (error) {
    logger.error({
      msg: 'Failed to send SMS',
      phone: formattedPhone,
      error: error.message,
    });
    throw new Error(`SMS delivery failed: ${error.message}`);
  }
};

/**
 * Send OTP via SMS
 * @param {string} phone - Recipient phone number
 * @param {string} otp - One-time password
 * @param {number} expiryMinutes - OTP expiry in minutes
 * @returns {Promise<{success: boolean}>}
 */
export const sendOtp = async (phone, otp, expiryMinutes = 10) => {
  const message = `Your ResQID verification code is ${otp}. Valid for ${expiryMinutes} minutes. Do not share with anyone. - ResQID`;

  return sendSms(phone, message);
};

/**
 * Send bulk SMS
 * @param {Array<{phone: string, message: string}>} messages
 * @returns {Promise<Array<{phone: string, success: boolean, error?: string}>>}
 */
export const sendBulkSms = async messages => {
  const results = [];

  for (const { phone, message } of messages) {
    try {
      const result = await sendSms(phone, message);
      results.push({ phone, success: true, messageId: result.messageId });
    } catch (error) {
      results.push({ phone, success: false, error: error.message });
    }
  }

  return results;
};

/**
 * Check SMS service health
 */
export const checkSmsHealth = async () => {
  if (!IS_PRODUCTION) {
    return { status: 'ok', mode: 'development', simulated: true };
  }

  if (!SMS_CONFIG.apiKey) {
    return { status: 'error', error: 'SMS API key not configured' };
  }

  return { status: 'ok', mode: 'production', provider: SMS_CONFIG.provider };
};

export default {
  sendSms,
  sendOtp,
  sendBulkSms,
  formatPhoneNumber,
  checkSmsHealth,
};
