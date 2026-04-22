// =============================================================================
// shared/utils/phoneNormalize.js — RESQID
// Single source of truth for phone number normalization.
// =============================================================================

/**
 * Normalize phone number for MSG91 API.
 * Strips non-digits, removes leading country code if present, then prepends country code.
 *
 * @param {string} phoneNumber - Raw phone number input
 * @param {string} countryCode - Country code without '+' (default: '91')
 * @returns {string} Normalized phone number with country code
 *
 * @example
 * normalizePhone('+919876543210', '91') // '919876543210'
 * normalizePhone('9876543210', '91')    // '919876543210'
 * normalizePhone('00919876543210', '91') // '919876543210'
 */
export const normalizePhone = (phoneNumber, countryCode = '91') => {
  if (!phoneNumber) return '';

  // Strip all non-digits
  let cleaned = phoneNumber.replace(/\D/g, '');

  // Remove leading country code if present
  if (cleaned.startsWith(countryCode)) {
    cleaned = cleaned.slice(countryCode.length);
  }

  // Remove any other leading zeros
  cleaned = cleaned.replace(/^0+/, '');

  // Prepend country code
  return `${countryCode}${cleaned}`;
};

export default normalizePhone;
