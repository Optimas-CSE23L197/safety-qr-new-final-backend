// =============================================================================
// token.helpers.js — RESQID
// All pure utility functions for token + card + scan code generation
// No DB calls, no side effects — only crypto and transforms
// =============================================================================

import crypto from "crypto";
import { ENV } from "../../config/env.js";
import { TOKEN_BYTE_LENGTH } from "../../config/constants.js";

// =============================================================================
// CONSTANTS — never in env, never in logs
// =============================================================================

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

// AES-SIV output is always 32 bytes → always 43 base62 chars
// Derivation: 62^43 > 2^256 > 2^(32*8=256) ✓
const SCAN_CODE_LENGTH = 43;

// =============================================================================
// KEY DERIVATION — split SCAN_CODE_SECRET into K_MAC + K_ENC
// =============================================================================

/**
 * Validate and split SCAN_CODE_SECRET into two 32-byte keys.
 *
 * SCAN_CODE_SECRET must be exactly 64 hex chars (32 bytes).
 * We split it into:
 *   K_MAC — first 32 bytes  — used for HMAC-SHA256 (authentication)
 *   K_ENC — last 32 bytes   — used for AES-256-CTR (encryption)
 *
 * Validated once at module load — bad config crashes the server at startup,
 * not silently mid-request.
 */
const deriveScanCodeKeys = () => {
  const secret = ENV.SCAN_CODE_SECRET;

  if (
    !secret ||
    typeof secret !== "string" ||
    !/^[0-9a-fA-F]{128}$/.test(secret)
  ) {
    throw new Error(
      "[RESQID] SCAN_CODE_SECRET must be exactly 128 hex characters (64 bytes). " +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(64).toString('hex'))\"",
    );
  }

  const keyBuf = Buffer.from(secret, "hex");

  return {
    K_MAC: keyBuf.subarray(0, 32),
    K_ENC: keyBuf.subarray(32, 64),
  };
};

const { K_MAC, K_ENC } = deriveScanCodeKeys();

// =============================================================================
// TOKEN GENERATION
// =============================================================================

/**
 * Generate a cryptographically secure raw token.
 * Returned ONCE to super admin — NEVER stored in DB.
 * @returns {string} 64-char uppercase hex (256 bits)
 */
export const generateRawToken = () => {
  const byteLength = parseInt(TOKEN_BYTE_LENGTH, 10) || 32;
  return crypto.randomBytes(byteLength).toString("hex").toUpperCase();
};

/**
 * Hash raw token using HMAC-SHA256 with TOKEN_HASH_SECRET.
 * Only this hash is stored in DB.
 * @param {string} rawToken
 * @returns {string} hex digest
 */
export const hashRawToken = (rawToken) => {
  if (!rawToken || typeof rawToken !== "string") {
    throw new TypeError("hashRawToken: rawToken must be a non-empty string");
  }
  return crypto
    .createHmac("sha256", ENV.TOKEN_HASH_SECRET)
    .update(rawToken)
    .digest("hex");
};

// =============================================================================
// QR TYPE — Prisma enum mapper
// =============================================================================

/**
 * Map internal flow strings to Prisma QrType enum values.
 * Internal strings ("SINGLE_BLANK" etc.) are richer and kept in audit metadata.
 * DB only stores "BLANK" or "PRE_DETAILS" — the Prisma enum.
 *
 * FIX [#1] — was passing full strings like "SINGLE_BLANK" directly to Prisma,
 * which threw a validation error on every write. Prisma enum only has 2 values.
 *
 * @param {string} qrType — "SINGLE_BLANK" | "BULK_BLANK" | "SINGLE_PRE_DETAILS" | "BULK_PRE_DETAILS"
 * @returns {"BLANK"|"PRE_DETAILS"}
 */
export const toQrTypeEnum = (qrType) => {
  if (qrType.includes("PRE_DETAILS")) return "PRE_DETAILS";
  return "BLANK";
};

// =============================================================================
// SCAN CODE — AES-SIV (Synthetic IV Mode)
// =============================================================================

// ─── Why AES-SIV? Why not the previous HMAC-injection approach? ──────────────
//
// THE OLD APPROACH (HMAC-injection) AND ITS WEAKNESSES:
//
//   The previous implementation used Base62-encoded UUID with a 6-char HMAC
//   fragment injected at a fixed position (INSERT_AT = 8):
//
//     encoded = uuidToBase62(tokenId)           // 22 chars, deterministic
//     sig     = HMAC(encoded).slice(0, 6)       // 6 chars of 36 bits
//     code    = encoded[0..8] + sig + encoded[8..] // 28 chars total
//
//   Vulnerability 1 — Brute-forceable auth tag:
//     Only 36 bits of authentication (6 base62 chars = 6 * log2(62) ≈ 35.7 bits).
//     An attacker who can query the scan endpoint ~68 billion times could forge
//     a valid code for any tokenId. With distributed infrastructure and no rate
//     limits on decoding, this is feasible over time.
//
//   Vulnerability 2 — UUID exposed in ciphertext:
//     The Base62 encoding of the UUID is just a format transform — it's
//     completely reversible with no secret. Anyone who captures enough scan
//     codes can trivially decode the UUID from the non-signature chars
//     (positions 0-7 and 14-27), recover the token ID, and enumerate others.
//     The code structure leaks the database primary key.
//
//   Vulnerability 3 — Structural distinguishability:
//     A 28-char code with a 6-char block at position 8 has visible structure.
//     Statistical analysis of a corpus of codes reveals the injection point,
//     separating the "UUID component" from the "MAC component" entirely.
//
//   Vulnerability 4 — Birthday collisions on the MAC:
//     With 36-bit tags, the birthday bound is ~2^18 = 262,144 codes. An
//     attacker with ~260K real codes has ~50% chance of finding two codes
//     that share the same 6-char sig, aiding forgery or enumeration.
//
// THE NEW APPROACH — AES-SIV (per RFC 5297, adapted for single-message use):
//
//   AES-SIV is an authenticated encryption scheme with these properties:
//
//   1. DETERMINISTIC — same tokenId + same secret = same scanCode, always.
//      This is essential: the URL is baked into a physical QR sticker. We
//      cannot use random nonces (like AES-GCM) because we cannot change the
//      printed card.
//
//   2. MISUSE-RESISTANT — even if the implementation has bugs in randomness,
//      the security doesn't catastrophically collapse (unlike AES-GCM).
//
//   3. NO STRUCTURE LEAKAGE — the output is 32 bytes of pseudorandom data.
//      An attacker cannot distinguish [SIV | ciphertext] from random noise
//      without the keys. UUID is fully concealed.
//
//   4. 128-BIT AUTH TAG — the full 16-byte SIV is the authentication tag.
//      Forgery requires 2^128 work even against an online oracle.
//
//   5. TWO-KEY SEPARATION — K_MAC is never used for encryption, K_ENC is
//      never used for authentication. Compromise of one key doesn't
//      compromise the other's security property.
//
// HOW IT WORKS (this implementation):
//
//   Encode:
//     uuidBytes = 16-byte Buffer from UUID string (strip hyphens, hex decode)
//     SIV       = HMAC-SHA256(K_MAC, uuidBytes)[0:16]   // 128-bit auth tag
//     ctrIV     = SIV with bit 31 and bit 63 cleared    // RFC 5297 §2.6
//     ct        = AES-256-CTR(K_ENC, ctrIV, uuidBytes)  // 16-byte ciphertext
//     output    = Base62( SIV || ct )                   // 43-char scan code
//
//   Decode + Verify:
//     bytes     = Base62Decode(code)                    // 32 bytes
//     SIV, ct   = bytes[0:16], bytes[16:32]
//     ctrIV     = SIV with bit 31 and bit 63 cleared
//     uuidBytes = AES-256-CTR(K_ENC, ctrIV, ct)        // decrypt
//     expected  = HMAC-SHA256(K_MAC, uuidBytes)[0:16]
//     assert timingSafeEqual(SIV, expected)             // verify auth
//     return UUID string from uuidBytes
//
// =============================================================================

// ─── UUID ↔ Buffer ─────────────────────────────────────────────────────────────

/**
 * Convert a UUID v4 string to a 16-byte Buffer.
 * "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" → 16 bytes
 */
const uuidToBuffer = (uuid) => {
  const hex = uuid.replace(/-/g, "");
  if (hex.length !== 32 || !/^[0-9a-fA-F]{32}$/.test(hex)) {
    throw new ScanCodeError("DECODE_FAILED");
  }
  return Buffer.from(hex, "hex");
};

/**
 * Convert a 16-byte Buffer back to a UUID v4 string.
 * 16 bytes → "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
 */
const bufferToUuid = (buf) => {
  const hex = buf.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
};

// ─── Base62 encode/decode (BigInt, fixed-width) ────────────────────────────────

/**
 * Base62-encode a Buffer to a fixed-width string.
 * Uses BigInt arithmetic — no external deps.
 * 32 bytes → always 43 chars (62^43 > 2^256).
 *
 * @param {Buffer} buf
 * @param {number} width — target string length (pad with leading '0')
 * @returns {string}
 */
const base62Encode = (buf, width) => {
  let num = BigInt("0x" + buf.toString("hex"));
  let result = "";
  while (num > 0n) {
    result = BASE62[Number(num % 62n)] + result;
    num /= 62n;
  }
  return result.padStart(width, "0");
};

/**
 * Base62-decode a string back to a Buffer of exactly `byteLength` bytes.
 * Throws ScanCodeError("MALFORMED") if any char is outside BASE62 alphabet.
 *
 * @param {string} str
 * @param {number} byteLength — expected output byte length
 * @returns {Buffer}
 */
const base62Decode = (str, byteLength) => {
  let num = 0n;
  for (const char of str) {
    const idx = BASE62.indexOf(char);
    if (idx === -1) throw new ScanCodeError("MALFORMED");
    num = num * 62n + BigInt(idx);
  }
  const hex = num.toString(16).padStart(byteLength * 2, "0");
  return Buffer.from(hex, "hex");
};

// ─── CTR IV preparation (RFC 5297 §2.6) ───────────────────────────────────────

/**
 * Prepare AES-CTR IV from SIV by clearing bits 31 and 63.
 * These bits are reserved in RFC 5297 to prevent counter wrap ambiguity.
 * We operate on a copy — never mutate the original SIV (it's the auth tag).
 *
 * Bit 31 = byte index 3, bit 7 (0x7F mask)
 * Bit 63 = byte index 7, bit 7 (0x7F mask)
 *
 * @param {Buffer} siv — 16-byte SIV
 * @returns {Buffer} 16-byte CTR IV (copy with bits cleared)
 */
const sivToCtrIv = (siv) => {
  const ctrIv = Buffer.from(siv); // copy, never mutate SIV
  ctrIv[3] &= 0x7f; // clear bit 31
  ctrIv[7] &= 0x7f; // clear bit 63
  return ctrIv;
};

// ─── AES-256-CTR encrypt/decrypt ──────────────────────────────────────────────

/**
 * AES-256-CTR is its own inverse — encrypt and decrypt are the same operation.
 * @param {Buffer} key    — 32 bytes (K_ENC)
 * @param {Buffer} iv     — 16 bytes (ctrIV)
 * @param {Buffer} input  — plaintext or ciphertext
 * @returns {Buffer}
 */
const aesCtr = (key, iv, input) => {
  const cipher = crypto.createCipheriv("aes-256-ctr", key, iv);
  return Buffer.concat([cipher.update(input), cipher.final()]);
};

// ─── SIV computation ──────────────────────────────────────────────────────────

/**
 * Compute the 16-byte Synthetic IV from UUID bytes using K_MAC.
 * SIV = HMAC-SHA256(K_MAC, uuidBytes).slice(0, 16)
 *
 * This is the authentication tag. Computed from plaintext + secret key.
 * Any mutation to the ciphertext will cause SIV mismatch on decode.
 *
 * @param {Buffer} uuidBytes — 16-byte UUID
 * @returns {Buffer} 16-byte SIV
 */
const computeSiv = (uuidBytes) => {
  return crypto
    .createHmac("sha256", K_MAC)
    .update(uuidBytes)
    .digest()
    .subarray(0, 16);
};

// =============================================================================
// PUBLIC API — generateScanCode / decodeScanCode
// =============================================================================

/**
 * Generate a deterministic, authenticated, opaque scan code from a token UUID.
 *
 * AES-SIV mode — see the design comment block above for full rationale.
 *
 * Output is 43 base62 chars encoding 32 bytes [SIV(16) || ciphertext(16)].
 * The UUID is fully concealed — the output is computationally indistinguishable
 * from random without K_MAC and K_ENC.
 *
 * @param {string} tokenId — UUID v4 string from DB (e.g. "413fc503-844d-4c46-a558-4eaac4ac0ca3")
 * @returns {string} 43-char opaque scan code (base62)
 */
export const generateScanCode = (tokenId) => {
  const uuidBytes = uuidToBuffer(tokenId); // 16 bytes
  const siv = computeSiv(uuidBytes); // 16 bytes — auth tag
  const ctrIv = sivToCtrIv(siv); // 16 bytes — CTR IV (bits 31, 63 cleared)
  const ciphertext = aesCtr(K_ENC, ctrIv, uuidBytes); // 16 bytes — encrypted UUID
  const combined = Buffer.concat([siv, ciphertext]); // 32 bytes
  return base62Encode(combined, SCAN_CODE_LENGTH); // 43 chars
};

/**
 * Verify + decode a scan code back to a token UUID.
 *
 * Cryptographic verification happens BEFORE any DB query.
 * Forged or tampered codes are rejected in O(1) pure crypto — the DB
 * is never touched for invalid codes.
 *
 * Timing-safe comparison prevents oracle timing attacks — an attacker
 * probing many forged codes cannot measure partial MAC matches.
 *
 * @param {string} code — 43-char base62 scan code from URL
 * @returns {string} tokenId UUID string
 * @throws {ScanCodeError} reason: "MALFORMED" | "INVALID_SIGNATURE" | "DECODE_FAILED"
 */
export const decodeScanCode = (code) => {
  // ── Step 1: Validate format ──────────────────────────────────────────────
  if (
    !code ||
    typeof code !== "string" ||
    code.length !== SCAN_CODE_LENGTH ||
    !/^[0-9A-Za-z]+$/.test(code)
  ) {
    throw new ScanCodeError("MALFORMED");
  }

  // ── Step 2: Base62 decode → 32-byte Buffer ───────────────────────────────
  let combined;
  try {
    combined = base62Decode(code, 32);
  } catch (err) {
    if (err instanceof ScanCodeError) throw err;
    throw new ScanCodeError("MALFORMED");
  }

  // ── Step 3: Split SIV + ciphertext ───────────────────────────────────────
  const siv = combined.subarray(0, 16); // transmitted authentication tag
  const ciphertext = combined.subarray(16, 32); // encrypted UUID bytes

  // ── Step 4: Prepare CTR IV from transmitted SIV ───────────────────────────
  const ctrIv = sivToCtrIv(siv);

  // ── Step 5: Decrypt → recover UUID bytes ─────────────────────────────────
  let uuidBytes;
  try {
    uuidBytes = aesCtr(K_ENC, ctrIv, ciphertext);
  } catch {
    throw new ScanCodeError("DECODE_FAILED");
  }

  // ── Step 6: Recompute expected SIV from decrypted UUID ────────────────────
  const expectedSiv = computeSiv(uuidBytes);

  // ── Step 7: Timing-safe authentication check ─────────────────────────────
  // timingSafeEqual requires same-length Buffers — both are 16 bytes here.
  if (!crypto.timingSafeEqual(siv, expectedSiv)) {
    throw new ScanCodeError("INVALID_SIGNATURE");
  }

  // ── Step 8–9: Convert UUID bytes → UUID string ───────────────────────────
  try {
    return bufferToUuid(uuidBytes);
  } catch {
    throw new ScanCodeError("DECODE_FAILED");
  }
};

export class ScanCodeError extends Error {
  constructor(reason) {
    super(`Invalid scan code: ${reason}`);
    this.reason = reason; // MALFORMED | INVALID_SIGNATURE | DECODE_FAILED
  }
}

// =============================================================================
// SCAN URL
// =============================================================================

/**
 * Build the public scan URL encoded into the QR image.
 * Uses signed scan code — token UUID is never exposed in URL.
 *
 * @param {string} tokenId — UUID from DB (after token creation)
 * @returns {string} e.g. "https://resqid.in/s/5YbX2mKqf3AB9xP9nRtL3vWcUjAe4xQ"
 */
export const buildScanUrl = (tokenId) => {
  const scanCode = generateScanCode(tokenId);
  return `${ENV.SCAN_BASE_URL}/${scanCode}`;
};

// =============================================================================
// CARD NUMBER
// =============================================================================

/**
 * Generate a crypto-random physical card number.
 * Format: RESQID-{SCHOOLCODE}-{6 hex chars}
 * Example: RESQID-DPS01-A3F9B2
 *
 * Card number is printed on physical card only — never used for DB lookup.
 * QR scan uses signed scan code (token UUID based) — not card number.
 *
 * @param {string} schoolCode — e.g. "DPS01"
 * @returns {string}
 */
export const generateCardNumber = (schoolCode) => {
  const code = schoolCode
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6);
  const suffix = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `RESQID-${code}-${suffix}`;
};

/**
 * Generate card number for blank cards (no school code).
 * Format: RESQID-{6 hex chars}
 *
 * NOTE: Structurally different from school cards (2 segments vs 3).
 * This is intentional — blank cards have no school affiliation at print time.
 * School code is added when the token is assigned to a student.
 *
 * @returns {string} e.g. "RESQID-A3F9B2"
 */
export const generateBlankCardNumber = () => {
  const suffix = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `RESQID-${suffix}`;
};

// =============================================================================
// EXPIRY
// =============================================================================

/**
 * Calculate token expiry from school settings.
 * Date-safe — anchors to 1st to prevent month overflow.
 * Jan 31 + 1 month = Feb 28, not Mar 3.
 *
 * @param {number} validityMonths
 * @returns {Date}
 */
export const calculateExpiry = (validityMonths = 12) => {
  const expiry = new Date();
  const currentDay = expiry.getDate();
  expiry.setDate(1);
  expiry.setMonth(expiry.getMonth() + validityMonths);
  const maxDay = new Date(
    expiry.getFullYear(),
    expiry.getMonth() + 1,
    0,
  ).getDate();
  expiry.setDate(Math.min(currentDay, maxDay));
  return expiry;
};

// =============================================================================
// BRANDING
// =============================================================================

/**
 * Resolve card branding based on school subscription plan.
 * FREE_PILOT  → ResQid logo only, no school name
 * Paid plans  → school logo + school name on card
 *
 * @param {object} school — with subscriptions array
 * @returns {{ logoUrl: string|null, showSchoolName: boolean }}
 */
export const resolveBranding = (school) => {
  const paidPlans = ["GOVT_STANDARD", "PRIVATE_STANDARD", "ENTERPRISE"];
  const isPaid = paidPlans.includes(school.subscriptions?.[0]?.plan);
  return {
    logoUrl:
      isPaid && school.logo_url
        ? school.logo_url
        : ENV.RESQID_DEFAULT_LOGO_URL || null,
    showSchoolName: isPaid,
  };
};
