// =============================================================================
// services/token/token.service.js — RESQID
// Complete token, QR, and card generation service for Order Orchestrator.
// Integrates with your existing crypto patterns.
// =============================================================================

import crypto from "crypto";
import { prisma } from "../../config/prisma.js";
import { ENV } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { uploadFile } from "../storage/storage.service.js";
import { generateQrImage } from "../qr/qr.service.js";
import {
  generateScanCode,
  decodeScanCode,
  ScanCodeError,
} from "./token.helpers.js";

// =============================================================================
// CONSTANTS
// =============================================================================

const TOKEN_BYTE_LENGTH = 32; // 256 bits
const SCAN_CODE_LENGTH = 43; // AES-SIV output in base62

// =============================================================================
// TOKEN GENERATION (For Order Orchestrator)
// =============================================================================

/**
 * Generate a cryptographically secure raw token.
 * Returned to super admin for download — NEVER stored in DB.
 * @returns {string} 64-char uppercase hex (256 bits)
 */
export const generateRawToken = () => {
  return crypto.randomBytes(TOKEN_BYTE_LENGTH).toString("hex").toUpperCase();
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
// CARD NUMBER GENERATION (Crypto-random, not sequential)
// =============================================================================

/**
 * Generate a crypto-random physical card number.
 * Format: RQ-{SCHOOLSERIAL}-{8 HEX CHARS}
 * Example: RQ-0042-C0C3B7F4
 *
 * @param {number} schoolSerial — School.serial_number (1-based)
 * @returns {string}
 */
export const generateCardNumber = (schoolSerial) => {
  const serial = String(schoolSerial).padStart(4, "0");
  const randomHex = crypto.randomBytes(4).toString("hex").toUpperCase();
  return `RQ-${serial}-${randomHex}`;
};

/**
 * Generate multiple card numbers in batch.
 * @param {number} schoolSerial
 * @param {number} count
 * @returns {string[]}
 */
export const batchGenerateCardNumbers = (schoolSerial, count) => {
  const serial = String(schoolSerial).padStart(4, "0");
  const cardNumbers = [];
  for (let i = 0; i < count; i++) {
    const randomHex = crypto.randomBytes(4).toString("hex").toUpperCase();
    cardNumbers.push(`RQ-${serial}-${randomHex}`);
  }
  return cardNumbers;
};

/**
 * Generate blank card number (no school assigned yet).
 * @returns {string}
 */
export const generateBlankCardNumber = () => {
  const randomHex = crypto.randomBytes(4).toString("hex").toUpperCase();
  return `RQ-BLANK-${randomHex}`;
};

// =============================================================================
// SCAN URL & QR GENERATION (For Order Orchestrator)
// =============================================================================

/**
 * Generate scan code (AES-SIV) from token ID.
 * Uses your existing crypto implementation.
 *
 * @param {string} tokenId — UUID from DB
 * @returns {string} 43-char base62 scan code
 */
export const generateScanCodeForToken = (tokenId) => {
  return generateScanCode(tokenId);
};

/**
 * Build the public scan URL encoded into the QR image.
 * @param {string} tokenId — UUID from DB
 * @returns {string} e.g. "https://resqid.in/s/5YbX2mKqf3AB9xP9nRtL3vWcUjAe4xQ"
 */
export const buildScanUrl = (tokenId) => {
  const scanCode = generateScanCodeForToken(tokenId);
  return `${ENV.SCAN_BASE_URL}/${scanCode}`;
};

/**
 * Generate QR image from scan URL and upload to S3.
 *
 * @param {object} params
 * @param {string} params.tokenId — UUID from DB
 * @param {string} params.schoolId
 * @param {string} params.orderId
 * @param {string} params.qrType — "BLANK" or "PRE_DETAILS"
 * @returns {Promise<{ qrUrl: string, storageKey: string }>}
 */
export const generateAndUploadQr = async ({
  tokenId,
  schoolId,
  orderId,
  qrType,
}) => {
  const scanUrl = buildScanUrl(tokenId);

  // Generate QR image (PNG)
  const qrBuffer = await generateQrImage(scanUrl, {
    width: 512,
    height: 512,
    margin: 1,
    color: {
      dark: "#000000",
      light: "#FFFFFF",
    },
  });

  // Upload to S3
  const storageKey = `qr/${schoolId}/${orderId}/${tokenId}.png`;
  const qrUrl = await uploadFile({
    key: storageKey,
    body: qrBuffer,
    contentType: "image/png",
    cacheControl: "public, max-age=31536000",
  });

  // Store QR asset in DB
  await prisma.qrAsset.create({
    data: {
      token_id: tokenId,
      school_id: schoolId,
      storage_key: storageKey,
      public_url: qrUrl,
      format: "PNG",
      width_px: 512,
      height_px: 512,
      qr_type: qrType,
      generated_by: "system",
      order_id: orderId,
    },
  });

  return { qrUrl, storageKey };
};

// =============================================================================
// BATCH TOKEN GENERATION (For Order Orchestrator Worker)
// =============================================================================

/**
 * Generate all tokens, cards, and QRs for an order.
 * Called by token.worker.js after advance payment.
 *
 * @param {object} params
 * @param {string} params.orderId
 * @param {string} params.schoolId
 * @param {number} params.schoolSerial
 * @param {number} params.cardCount
 * @param {string} params.orderType — "BLANK" or "PRE_DETAILS"
 * @param {Array} params.items — CardOrderItems for PRE_DETAILS
 * @param {string} params.batchId — TokenBatch ID
 * @returns {Promise<{ tokens: Array, cards: Array, qrs: Array }>}
 */
export const batchGenerateTokensAndCards = async ({
  orderId,
  schoolId,
  schoolSerial,
  cardCount,
  orderType,
  items = [],
  batchId,
}) => {
  const tokens = [];
  const cards = [];
  const qrs = [];

  // Generate card numbers first (crypto-random)
  const cardNumbers = batchGenerateCardNumbers(schoolSerial, cardCount);

  // Generate tokens in sequence
  for (let i = 0; i < cardCount; i++) {
    // 1. Generate raw token and hash
    const rawToken = generateRawToken();
    const tokenHash = hashRawToken(rawToken);

    // 2. Create token record
    const token = await prisma.token.create({
      data: {
        school_id: schoolId,
        order_id: orderId,
        token_hash: tokenHash,
        status: "UNASSIGNED",
        batch_id: batchId,
        // For PRE_DETAILS, link to student data
        ...(orderType === "PRE_DETAILS" &&
          items[i] && {
            order_item_id: items[i].id,
            student_id: items[i].student_id,
          }),
      },
    });

    // 3. Generate scan URL and QR
    const scanUrl = buildScanUrl(token.id);
    const qrBuffer = await generateQrImage(scanUrl, {
      width: 512,
      height: 512,
      margin: 1,
    });

    // 4. Upload QR to S3
    const storageKey = `qr/${schoolId}/${orderId}/${token.id}.png`;
    const qrUrl = await uploadFile({
      key: storageKey,
      body: qrBuffer,
      contentType: "image/png",
    });

    // 5. Store QR asset
    await prisma.qrAsset.create({
      data: {
        token_id: token.id,
        school_id: schoolId,
        storage_key: storageKey,
        public_url: qrUrl,
        format: "PNG",
        width_px: 512,
        height_px: 512,
        qr_type: orderType,
        generated_by: "system",
        order_id: orderId,
      },
    });

    // 6. Create card record with crypto-random number
    const card = await prisma.card.create({
      data: {
        school_id: schoolId,
        token_id: token.id,
        order_id: orderId,
        card_number: cardNumbers[i],
        print_status: "PENDING",
      },
    });

    tokens.push({
      tokenId: token.id,
      rawToken, // Return for super admin download
      tokenHash,
      scanUrl,
      qrUrl,
    });

    cards.push(card);
    qrs.push({ tokenId: token.id, qrUrl });

    // Log progress
    if ((i + 1) % 100 === 0) {
      logger.info({
        msg: `Generated ${i + 1}/${cardCount} tokens for order`,
        orderId,
        progress: Math.round(((i + 1) / cardCount) * 100),
      });
    }
  }

  return {
    tokens,
    cards,
    qrs,
    totalGenerated: tokens.length,
  };
};

// =============================================================================
// SCAN RESOLUTION (Public API)
// =============================================================================

/**
 * Resolve a scan code to token and student data.
 * Used by scan.controller.js — matches your existing flow.
 *
 * @param {string} scanCode — 43-char base62 code
 * @returns {Promise<{ token: object, student: object, school: object, emergency: object }>}
 */
export const resolveScanCode = async (scanCode) => {
  // 1. Decode and verify scan code (AES-SIV)
  let tokenId;
  try {
    tokenId = decodeScanCode(scanCode);
  } catch (err) {
    if (err instanceof ScanCodeError) {
      throw new Error(`Invalid scan code: ${err.reason}`);
    }
    throw err;
  }

  // 2. Fetch token with all related data
  const token = await prisma.token.findUnique({
    where: { id: tokenId },
    include: {
      school: {
        select: {
          id: true,
          name: true,
          code: true,
          logo_url: true,
          phone: true,
          address: true,
        },
      },
      student: {
        include: {
          cardVisibility: true,
          emergency: {
            include: {
              contacts: {
                where: { is_active: true },
                orderBy: { priority: "asc" },
              },
            },
          },
        },
      },
    },
  });

  if (!token) {
    throw new Error("Token not found");
  }

  // 3. Validate token state
  const validation = validateTokenState(token);
  if (!validation.valid) {
    throw new Error(validation.reason);
  }

  // 4. Build response with visibility rules
  const profile = buildEmergencyProfile(
    token.student,
    token.student?.emergency,
  );

  return {
    token: {
      id: token.id,
      status: token.status,
      expires_at: token.expires_at,
    },
    school: {
      name: token.school?.name,
      logo_url: token.school?.logo_url,
      phone: token.school?.phone,
      address: token.school?.address,
    },
    student: token.student
      ? {
          name: `${token.student.first_name || ""} ${token.student.last_name || ""}`.trim(),
          photo_url: token.student.photo_url,
          class: token.student.class,
          section: token.student.section,
        }
      : null,
    emergency: profile,
  };
};

/**
 * Validate token state for scanning.
 */
const validateTokenState = (token) => {
  if (!token) return { valid: false, reason: "NOT_FOUND" };
  if (token.status === "REVOKED") return { valid: false, reason: "REVOKED" };
  if (token.status === "EXPIRED") return { valid: false, reason: "EXPIRED" };
  if (token.status === "INACTIVE") return { valid: false, reason: "INACTIVE" };
  if (token.status !== "ACTIVE") return { valid: false, reason: "INVALID" };
  if (token.expires_at && token.expires_at < new Date()) {
    return { valid: false, reason: "EXPIRED" };
  }
  return { valid: true, reason: null };
};

/**
 * Build emergency profile with visibility rules.
 */
const buildEmergencyProfile = (student, emergency) => {
  if (!student) return null;

  const visibility =
    emergency?.visibility || student?.cardVisibility?.visibility || "PUBLIC";

  if (visibility === "HIDDEN") {
    return {
      visibility: "HIDDEN",
      message: "Emergency information is hidden",
    };
  }

  const profile = {
    visibility,
    name: `${student.first_name || ""} ${student.last_name || ""}`.trim(),
    photo_url: student.photo_url,
    class: student.class,
    section: student.section,
  };

  if (visibility === "PUBLIC" && emergency) {
    profile.blood_group = emergency.blood_group
      ?.replace("_POS", "+")
      .replace("_NEG", "-");
    profile.allergies = emergency.allergies;
    profile.conditions = emergency.conditions;
    profile.medications = emergency.medications;
    profile.notes = emergency.notes;

    if (emergency.contacts?.length) {
      profile.contacts = emergency.contacts.map((contact) => ({
        name: contact.name,
        relationship: contact.relationship,
        phone: decryptField(contact.phone_encrypted),
        priority: contact.priority,
        call_enabled: contact.call_enabled,
        whatsapp_enabled: contact.whatsapp_enabled,
      }));
    }

    if (emergency.doctor_name) {
      profile.doctor = {
        name: emergency.doctor_name,
        phone: decryptField(emergency.doctor_phone_encrypted),
      };
    }
  } else if (visibility === "MINIMAL" && emergency?.contacts?.length) {
    const primaryContact =
      emergency.contacts.find((c) => c.priority === 1) || emergency.contacts[0];
    profile.primary_contact = {
      name: primaryContact.name,
      relationship: primaryContact.relationship,
      phone: decryptField(primaryContact.phone_encrypted),
    };
  }

  return profile;
};

/**
 * Decrypt encrypted field (AES-256-GCM).
 */
const decryptField = (encrypted) => {
  if (!encrypted) return null;
  try {
    // Import your existing decryption logic
    const { decrypt } = require("../../utils/security/encryption.js");
    return decrypt(encrypted);
  } catch {
    return null;
  }
};
