// =============================================================================
// encryption.js — RESQID
// AES-256-GCM authenticated encryption for all PII stored in DB
//
// Used for: phone_encrypted, dob_encrypted, doctor_phone_encrypted
// in EmergencyContact and EmergencyProfile models
//
// Why AES-256-GCM:
//   - 256-bit key = unbreakable with current technology
//   - GCM mode = authenticated encryption (detects tampering)
//   - Unique IV per encryption = same value encrypts differently each time
//
// Format stored in DB: "iv:authTag:ciphertext" (all hex)
// =============================================================================

import crypto from "crypto";
import { ENV } from "../../config/env.js";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96-bit IV — GCM standard
const TAG_LENGTH = 16; // 128-bit auth tag
const SEPARATOR = ":";

// ─── Key Derivation ───────────────────────────────────────────────────────────
// Derive a 32-byte key from the env secret using HKDF
// This means the raw env value doesn't need to be exactly 32 bytes

function deriveKey() {
  if (!ENV.ENCRYPTION_KEY) {
    throw new Error("ENCRYPTION_KEY environment variable is not set");
  }
  return crypto.createHash("sha256").update(ENV.ENCRYPTION_KEY).digest(); // returns Buffer of 32 bytes
}

const KEY = deriveKey(); // Derived once at startup

// ─── Encrypt ──────────────────────────────────────────────────────────────────

/**
 * encryptField(plaintext)
 * Encrypts a string — stores as "iv:authTag:ciphertext" hex
 * Returns null if plaintext is null/undefined
 *
 * @param   {string|null} plaintext
 * @returns {string|null}
 */
export function encryptField(plaintext) {
  if (plaintext == null) return null;
  if (typeof plaintext !== "string") {
    throw new TypeError("encryptField: plaintext must be a string");
  }

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv, {
    authTagLength: TAG_LENGTH,
  });

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  return [
    iv.toString("hex"),
    authTag.toString("hex"),
    encrypted.toString("hex"),
  ].join(SEPARATOR);
}

// ─── Decrypt ──────────────────────────────────────────────────────────────────

/**
 * decryptField(ciphertext)
 * Decrypts a "iv:authTag:ciphertext" hex string
 * Returns null if ciphertext is null/undefined
 * Throws if data is tampered with (GCM auth tag mismatch)
 *
 * @param   {string|null} ciphertext
 * @returns {string|null}
 */
export function decryptField(ciphertext) {
  if (ciphertext == null) return null;
  if (typeof ciphertext !== "string") {
    throw new TypeError("decryptField: ciphertext must be a string");
  }

  const parts = ciphertext.split(SEPARATOR);
  if (parts.length !== 3) {
    throw new Error("decryptField: invalid ciphertext format");
  }

  const [ivHex, authTagHex, encryptedHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const encrypted = Buffer.from(encryptedHex, "hex");

  const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv, {
    authTagLength: TAG_LENGTH,
  });
  decipher.setAuthTag(authTag);

  try {
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  } catch {
    // GCM auth tag failed — data was tampered with or wrong key
    throw new Error(
      "decryptField: decryption failed — data may be corrupted or tampered",
    );
  }
}

// ─── Batch Helpers ────────────────────────────────────────────────────────────

/**
 * encryptFields(obj, fields)
 * Encrypt multiple fields at once
 *
 * @example
 * const encrypted = encryptFields(body, ['phone', 'dob'])
 * // { phone: 'iv:tag:cipher', dob: 'iv:tag:cipher', ...rest }
 */
export function encryptFields(obj, fields) {
  const result = { ...obj };
  for (const field of fields) {
    if (result[field] != null) {
      result[`${field}_encrypted`] = encryptField(result[field]);
      delete result[field]; // remove plaintext
    }
  }
  return result;
}

/**
 * decryptFields(obj, fields)
 * Decrypt multiple fields at once — for internal service use
 */
export function decryptFields(obj, fields) {
  const result = { ...obj };
  for (const field of fields) {
    const encryptedKey = `${field}_encrypted`;
    if (result[encryptedKey] != null) {
      result[field] = decryptField(result[encryptedKey]);
      delete result[encryptedKey];
    }
  }
  return result;
}

// ─── Deterministic Encryption for Lookups ────────────────────────────────────
// Regular encryption uses random IV → same input = different output each time
// For fields we need to SEARCH by (phone_index), use HMAC instead

/**
 * hashForLookup(value)
 * HMAC-SHA256 of a value — deterministic, one-way, collision-resistant
 * Used for phone_index — allows exact-match lookup without storing plaintext
 *
 * @param   {string} value
 * @returns {string} 64-char hex HMAC
 */
export function hashForLookup(value) {
  if (!value) return null;
  if (!ENV.LOOKUP_HASH_SECRET) {
    throw new Error("LOOKUP_HASH_SECRET environment variable is not set");
  }
  return crypto
    .createHmac("sha256", ENV.LOOKUP_HASH_SECRET)
    .update(value.toLowerCase().trim())
    .digest("hex");
}
