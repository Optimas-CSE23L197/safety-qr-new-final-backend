// =============================================================================
// services/token/token.helpers.js — RESQID
// ALL pure utility functions for token + card + scan code generation.
// No DB calls, no side effects — only crypto and transforms.
//
// This is the AUTHORITATIVE source for all token/card/scan helpers.
// token.service.js re-exports from here — zero duplication.
// =============================================================================

import crypto from 'crypto';
import { ENV } from '#config/env.js';
import { TOKEN_BYTE_LENGTH } from '#config/constants.js';

// =============================================================================
// CONSTANTS
// =============================================================================

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

// AES-SIV output is always 32 bytes → always 43 base62 chars
const SCAN_CODE_LENGTH = 43;

// =============================================================================
// KEY DERIVATION — split SCAN_CODE_SECRET into K_MAC + K_ENC
// =============================================================================

const deriveScanCodeKeys = () => {
  const secret = ENV.SCAN_CODE_SECRET;

  if (!secret || typeof secret !== 'string' || !/^[0-9a-fA-F]{128}$/.test(secret)) {
    throw new Error(
      `[RESQID] SCAN_CODE_SECRET must be exactly 128 hex characters (64 bytes). ` +
        `Generate: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`
    );
  }

  const keyBuf = Buffer.from(secret, 'hex');
  return { K_MAC: keyBuf.subarray(0, 32), K_ENC: keyBuf.subarray(32, 64) };
};

const { K_MAC, K_ENC } = deriveScanCodeKeys();

// =============================================================================
// TOKEN GENERATION
// =============================================================================

/**
 * Generate a cryptographically secure raw token.
 * Returned ONCE to super admin — NEVER stored in DB.
 * Uses crypto.randomBytes — no external deps.
 * @returns {string} 64-char uppercase hex (256 bits)
 */
export const generateRawToken = () => {
  const byteLength = parseInt(TOKEN_BYTE_LENGTH, 10) || 32;
  return crypto.randomBytes(byteLength).toString('hex').toUpperCase();
};

/**
 * Hash raw token using HMAC-SHA256 with TOKEN_HASH_SECRET.
 * Only this hash is stored in DB — raw token is never persisted.
 * @param {string} rawToken
 * @returns {string} hex digest
 */
export const hashRawToken = rawToken => {
  if (!rawToken || typeof rawToken !== 'string') {
    throw new TypeError('hashRawToken: rawToken must be a non-empty string');
  }
  return crypto.createHmac('sha256', ENV.TOKEN_HASH_SECRET).update(rawToken).digest('hex');
};

// =============================================================================
// QR TYPE — Prisma enum mapper
// =============================================================================

/**
 * Map internal flow strings to Prisma QrType enum values.
 * Prisma enum has exactly 2 values: BLANK | PRE_DETAILS.
 * @param {string} qrType — "SINGLE_BLANK" | "BULK_BLANK" | "SINGLE_PRE_DETAILS" | "BULK_PRE_DETAILS" | "BLANK" | "PRE_DETAILS"
 * @returns {'BLANK' | 'PRE_DETAILS'}
 */
export const toQrTypeEnum = qrType => {
  if (typeof qrType === 'string' && qrType.includes('PRE_DETAILS')) return 'PRE_DETAILS';
  return 'BLANK';
};

// =============================================================================
// SCAN CODE — AES-SIV (Synthetic IV Mode)
// See full design rationale in the original token.helpers.js comments.
// TL;DR: deterministic, 128-bit auth tag, UUID fully concealed, no external deps.
// =============================================================================

// ── UUID ↔ Buffer ─────────────────────────────────────────────────────────────

const uuidToBuffer = uuid => {
  const hex = uuid.replace(/-/g, '');
  if (hex.length !== 32 || !/^[0-9a-fA-F]{32}$/.test(hex)) {
    throw new ScanCodeError('DECODE_FAILED');
  }
  return Buffer.from(hex, 'hex');
};

const bufferToUuid = buf => {
  const hex = buf.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
};

// ── Base62 encode/decode ──────────────────────────────────────────────────────

const base62Encode = (buf, width) => {
  let num = BigInt('0x' + buf.toString('hex'));
  let result = '';
  while (num > 0n) {
    result = BASE62[Number(num % 62n)] + result;
    num /= 62n;
  }
  return result.padStart(width, '0');
};

const base62Decode = (str, byteLength) => {
  let num = 0n;
  for (const char of str) {
    const idx = BASE62.indexOf(char);
    if (idx === -1) throw new ScanCodeError('MALFORMED');
    num = num * 62n + BigInt(idx);
  }
  const hex = num.toString(16).padStart(byteLength * 2, '0');
  return Buffer.from(hex, 'hex');
};

// ── CTR IV preparation (RFC 5297 §2.6) ───────────────────────────────────────

const sivToCtrIv = siv => {
  const ctrIv = Buffer.from(siv);
  ctrIv[3] &= 0x7f; // clear bit 31
  ctrIv[7] &= 0x7f; // clear bit 63
  return ctrIv;
};

// ── AES-256-CTR ───────────────────────────────────────────────────────────────

const aesCtr = (key, iv, input) => {
  const cipher = crypto.createCipheriv('aes-256-ctr', key, iv);
  return Buffer.concat([cipher.update(input), cipher.final()]);
};

// ── SIV computation ───────────────────────────────────────────────────────────

const computeSiv = uuidBytes =>
  crypto.createHmac('sha256', K_MAC).update(uuidBytes).digest().subarray(0, 16);

// =============================================================================
// PUBLIC API — generateScanCode / decodeScanCode
// =============================================================================

/**
 * Generate a deterministic, authenticated, opaque scan code from a token UUID.
 * Output: 43-char base62 encoding of [SIV(16) || ciphertext(16)].
 * UUID is fully concealed — indistinguishable from random without K_MAC + K_ENC.
 *
 * @param {string} tokenId — UUID v4 from DB
 * @returns {string} 43-char base62 scan code
 */
export const generateScanCode = tokenId => {
  const uuidBytes = uuidToBuffer(tokenId);
  const siv = computeSiv(uuidBytes);
  const ctrIv = sivToCtrIv(siv);
  const ciphertext = aesCtr(K_ENC, ctrIv, uuidBytes);
  return base62Encode(Buffer.concat([siv, ciphertext]), SCAN_CODE_LENGTH);
};

/**
 * Verify + decode a scan code back to a token UUID.
 * Cryptographic verification happens BEFORE any DB query.
 *
 * @param {string} code — 43-char base62 scan code from URL
 * @returns {string} tokenId UUID
 * @throws {ScanCodeError} reason: 'MALFORMED' | 'INVALID_SIGNATURE' | 'DECODE_FAILED'
 */
export const decodeScanCode = code => {
  if (
    !code ||
    typeof code !== 'string' ||
    code.length !== SCAN_CODE_LENGTH ||
    !/^[0-9A-Za-z]+$/.test(code)
  ) {
    throw new ScanCodeError('MALFORMED');
  }

  let combined;
  try {
    combined = base62Decode(code, 32);
  } catch (err) {
    throw err instanceof ScanCodeError ? err : new ScanCodeError('MALFORMED');
  }

  const siv = combined.subarray(0, 16);
  const ciphertext = combined.subarray(16, 32);
  const ctrIv = sivToCtrIv(siv);

  let uuidBytes;
  try {
    uuidBytes = aesCtr(K_ENC, ctrIv, ciphertext);
  } catch {
    throw new ScanCodeError('DECODE_FAILED');
  }

  const expectedSiv = computeSiv(uuidBytes);
  if (!crypto.timingSafeEqual(siv, expectedSiv)) throw new ScanCodeError('INVALID_SIGNATURE');

  try {
    return bufferToUuid(uuidBytes);
  } catch {
    throw new ScanCodeError('DECODE_FAILED');
  }
};

export class ScanCodeError extends Error {
  constructor(reason) {
    super(`Invalid scan code: ${reason}`);
    this.reason = reason;
  }
}

// =============================================================================
// SCAN URL
// =============================================================================

/**
 * Build the public scan URL encoded into the QR image.
 * Token UUID is never exposed in the URL — only the opaque AES-SIV scan code.
 * @param {string} tokenId
 * @returns {string} e.g. "https://resqid.in/s/5YbX2mKqf3AB9xP9nRtL3vWcUjAe4xQ"
 */
export const buildScanUrl = tokenId => `${ENV.SCAN_BASE_URL}/${generateScanCode(tokenId)}`;

// =============================================================================
// CARD NUMBER — crypto-random, collision-safe
// =============================================================================

/**
 * Generate one crypto-random physical card number.
 * Format: RQ-{4-digit serial}-{8 HEX CHARS} = always 16 characters.
 * Example: RQ-0042-C0C3B7F4
 *
 * Uses crypto.randomBytes — no sequential counters, no guessable patterns.
 * Collision probability: 1 in 16.7M per school serial. Caller checks DB.
 *
 * @param {number} schoolSerial
 * @returns {string}
 */
export const generateCardNumber = schoolSerial => {
  const serial = String(schoolSerial).padStart(4, '0');
  const hex = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `RQ-${serial}-${hex}`;
};

/**
 * Generate N card numbers for a school in batch.
 * @param {number} schoolSerial
 * @param {number} count
 * @returns {string[]}
 */
export const batchGenerateCardNumbers = (schoolSerial, count) => {
  const serial = String(schoolSerial).padStart(4, '0');
  return Array.from({ length: count }, () => {
    const hex = crypto.randomBytes(4).toString('hex').toUpperCase();
    return `RQ-${serial}-${hex}`;
  });
};

/**
 * Generate a blank card number (no school assigned yet).
 * Format: RESQID-{6 HEX CHARS}
 * Structurally different from school cards — 2 segments vs 3.
 * @returns {string}
 */
export const generateBlankCardNumber = () => {
  const suffix = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `RESQID-${suffix}`;
};

// =============================================================================
// EXPIRY
// =============================================================================

/**
 * Calculate token expiry date from school validity setting.
 * Date-safe: anchors to 1st to prevent month overflow (Jan 31 + 1 month = Feb 28, not Mar 3).
 * @param {number} validityMonths
 * @returns {Date}
 */
export const calculateExpiry = (validityMonths = 12) => {
  const expiry = new Date();
  const currentDay = expiry.getDate();
  expiry.setDate(1);
  expiry.setMonth(expiry.getMonth() + validityMonths);
  const maxDay = new Date(expiry.getFullYear(), expiry.getMonth() + 1, 0).getDate();
  expiry.setDate(Math.min(currentDay, maxDay));
  return expiry;
};

// =============================================================================
// BRANDING
// =============================================================================

/**
 * Resolve card branding based on school subscription plan.
 * FREE_PILOT  → ResQID default logo, no school name on card.
 * Paid plans  → school logo + school name on card.
 *
 * @param {object} school — with subscriptions array
 * @returns {{ logoUrl: string|null, showSchoolName: boolean }}
 */
export const resolveBranding = school => {
  const paidPlans = ['GOVT_STANDARD', 'PRIVATE_STANDARD', 'ENTERPRISE'];
  const isPaid = paidPlans.includes(school.subscriptions?.[0]?.plan);
  return {
    logoUrl: isPaid && school.logo_url ? school.logo_url : ENV.RESQID_DEFAULT_LOGO_URL || null,
    showSchoolName: isPaid,
  };
};
