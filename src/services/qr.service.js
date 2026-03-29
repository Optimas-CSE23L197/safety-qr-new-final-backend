// =============================================================================
// services/qr/qr.service.js — RESQID
// QR code generation — produces PNG buffer from a URL.
// Uses 'qrcode' package. Install: npm install qrcode
//
// IMPROVED vs original:
//   [L-3 FIXED] Top-level import instead of dynamic import on every call
//   Added generateQrPngWithOptions for callers that need custom sizing
//   Consistent error messages
// =============================================================================

import QRCode from 'qrcode';

// ── Default options ───────────────────────────────────────────────────────────

const DEFAULT_OPTIONS = {
  type: 'png',
  width: 512,
  margin: 2,
  color: { dark: '#000000', light: '#FFFFFF' },
  errorCorrectionLevel: 'H', // highest — survives partial card damage
};

// =============================================================================
// generateQrPng — generate a QR PNG buffer from a URL string
//
// @param {string} url  — scan URL e.g. 'https://resqid.in/s/5YbX2m...'
// @returns {Promise<Buffer>} — PNG buffer ready for S3 upload
// =============================================================================

export const generateQrPng = async url => {
  if (!url || typeof url !== 'string') {
    throw new TypeError('generateQrPng: url must be a non-empty string');
  }

  try {
    return await QRCode.toBuffer(url, DEFAULT_OPTIONS);
  } catch (err) {
    throw new Error(`QR generation failed for URL "${url.slice(0, 40)}...": ${err.message}`);
  }
};

// =============================================================================
// generateQrPngWithOptions — custom size/margin/colors
//
// @param {string} url
// @param {object} options — merged with defaults
// @returns {Promise<Buffer>}
// =============================================================================

export const generateQrPngWithOptions = async (url, options = {}) => {
  if (!url || typeof url !== 'string') {
    throw new TypeError('generateQrPngWithOptions: url must be a non-empty string');
  }

  try {
    return await QRCode.toBuffer(url, { ...DEFAULT_OPTIONS, ...options });
  } catch (err) {
    throw new Error(`QR generation failed: ${err.message}`);
  }
};

// =============================================================================
// generateQrDataUrl — base64 data URL (for inline preview, not for S3)
// =============================================================================

export const generateQrDataUrl = async url => {
  if (!url || typeof url !== 'string') {
    throw new TypeError('generateQrDataUrl: url must be a non-empty string');
  }

  try {
    return await QRCode.toDataURL(url, {
      type: 'image/png',
      width: 256,
      errorCorrectionLevel: 'H',
    });
  } catch (err) {
    throw new Error(`QR data URL generation failed: ${err.message}`);
  }
};
