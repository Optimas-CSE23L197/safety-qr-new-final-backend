// =============================================================================
// fileUtil.js — RESQID
// File handling utilities for all upload types in the system:
//   - Student photos (profile images)
//   - QR code PNGs (generated, stored to S3)
//   - Card PDFs (generated for printing)
//   - School logos
//
// Never trust the file extension or Content-Type header alone.
// Read the actual file magic bytes to determine real MIME type.
// =============================================================================

import path from 'path';
import crypto from 'crypto';

// ─── Allowed File Types ────────────────────────────────────────────────────────

/**
 * Allowed types per upload context.
 * 'magic' = first bytes (hex) that identify the file format.
 */
export const ALLOWED_TYPES = {
  STUDENT_PHOTO: {
    mimes: ['image/jpeg', 'image/png', 'image/webp'],
    extensions: ['.jpg', '.jpeg', '.png', '.webp'],
    maxBytes: 5 * 1024 * 1024, // 5MB
    magic: {
      'image/jpeg': ['ffd8ff'],
      'image/png': ['89504e47'],
      'image/webp': ['52494646'],
    },
  },
  SCHOOL_LOGO: {
    mimes: ['image/jpeg', 'image/png', 'image/svg+xml'],
    extensions: ['.jpg', '.jpeg', '.png', '.svg'],
    maxBytes: 2 * 1024 * 1024, // 2MB
    magic: {
      'image/jpeg': ['ffd8ff'],
      'image/png': ['89504e47'],
      'image/svg+xml': ['3c737667', '3c3f786d', '3c21444f'], // <svg, <?xm, <!DO
    },
  },
  CARD_PDF: {
    mimes: ['application/pdf'],
    extensions: ['.pdf'],
    maxBytes: 20 * 1024 * 1024, // 20MB — batch PDFs can be large
    magic: {
      'application/pdf': ['25504446'], // %PDF
    },
  },
  QR_IMAGE: {
    mimes: ['image/png'],
    extensions: ['.png'],
    maxBytes: 500 * 1024, // 500KB — QR codes are small
    magic: {
      'image/png': ['89504e47'],
    },
  },
};

// ─── Magic Byte Validation ────────────────────────────────────────────────────

/**
 * getMimeFromBuffer(buffer)
 * Reads first 8 bytes and matches against known magic numbers.
 * Returns detected MIME or null if unknown.
 *
 * @param {Buffer} buffer - File buffer (first 8+ bytes is enough)
 * @returns {string|null}
 */
export function getMimeFromBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return null;

  const hex = buffer.slice(0, 8).toString('hex').toLowerCase();

  if (hex.startsWith('ffd8ff')) return 'image/jpeg';
  if (hex.startsWith('89504e47')) return 'image/png';
  if (hex.startsWith('52494646')) return 'image/webp'; // RIFF....WEBP
  if (hex.startsWith('25504446')) return 'application/pdf';
  if (hex.startsWith('3c737667') || hex.startsWith('3c3f786d') || hex.startsWith('3c21444f'))
    return 'image/svg+xml';

  return null;
}

// ─── File Validators ──────────────────────────────────────────────────────────

/**
 * validateFile(file, uploadContext)
 * Complete file validation — size, extension, MIME (from magic bytes).
 * Returns { valid: true } or { valid: false, reason: string }
 *
 * @param {{ originalname: string, size: number, buffer: Buffer, mimetype: string }} file
 * @param {keyof typeof ALLOWED_TYPES} uploadContext
 */
export function validateFile(file, uploadContext) {
  const config = ALLOWED_TYPES[uploadContext];
  if (!config) {
    return { valid: false, reason: `Unknown upload context: ${uploadContext}` };
  }

  // [1] Size check
  if (file.size > config.maxBytes) {
    return {
      valid: false,
      reason: `File too large. Maximum allowed: ${formatBytes(config.maxBytes)}. Got: ${formatBytes(file.size)}`,
    };
  }

  // [2] Extension check
  const ext = path.extname(file.originalname).toLowerCase();
  if (!config.extensions.includes(ext)) {
    return {
      valid: false,
      reason: `Invalid file extension "${ext}". Allowed: ${config.extensions.join(', ')}`,
    };
  }

  // [3] Magic byte check (if buffer available)
  if (file.buffer) {
    const detectedMime = getMimeFromBuffer(file.buffer);
    if (!detectedMime) {
      return {
        valid: false,
        reason: 'Could not determine file type from content',
      };
    }
    if (!config.mimes.includes(detectedMime)) {
      return {
        valid: false,
        reason: `File content does not match allowed types. Detected: ${detectedMime}`,
      };
    }
    // Extension must match detected MIME
    const expectedMimes = config.magic[detectedMime] !== undefined;
    if (!expectedMimes) {
      return {
        valid: false,
        reason: 'File extension does not match file content',
      };
    }
  }

  return { valid: true };
}

// ─── File Naming ──────────────────────────────────────────────────────────────

/**
 * generateStoragePath(context, entityId, originalName)
 * Deterministic, collision-safe S3/storage key.
 * Never use original filename in storage — prevents path traversal and collisions.
 *
 * Examples:
 *   student-photos/2024/01/abc123_8f3d2a1b.jpg
 *   school-logos/abc123_c1d2e3f4.png
 *   qr-codes/token-abc123_2024_01.png
 *   card-pdfs/batch-xyz_2024_01.pdf
 *
 * @param {'student-photos'|'school-logos'|'qr-codes"|"card-pdfs"} context
 * @param {string} entityId  - Student ID, School ID, Token ID, etc.
 * @param {string} originalName
 * @returns {string}
 */
export function generateStoragePath(context, entityId, originalName) {
  const ext = path.extname(originalName).toLowerCase();
  const randomHex = crypto.randomBytes(4).toString('hex');
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');

  return `${context}/${year}/${month}/${entityId}_${randomHex}${ext}`;
}

/**
 * generateQrStoragePath(tokenId)
 * Specific path for QR code PNGs.
 */
export function generateQrStoragePath(tokenId) {
  return `qr-codes/${tokenId}.png`;
}

/**
 * generateCardPdfPath(batchId)
 * Specific path for card batch PDFs.
 */
export function generateCardPdfPath(batchId) {
  const date = new Date();
  const stamp = `${date.getFullYear()}_${String(date.getMonth() + 1).padStart(2, '0')}`;
  return `card-pdfs/batch-${batchId}_${stamp}.pdf`;
}

// ─── Formatting Helpers ───────────────────────────────────────────────────────

/**
 * formatBytes(bytes, decimals = 2)
 * Human-readable file size: 1048576 → "1.00 MB"
 */
export function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

/**
 * getExtension(filename)
 * Safe extension extraction — always lowercase
 */
export function getExtension(filename) {
  if (!filename) return '';
  return path.extname(filename).toLowerCase();
}

/**
 * isImage(mimeType)
 */
export function isImage(mimeType) {
  return typeof mimeType === 'string' && mimeType.startsWith('image/');
}

/**
 * isPdf(mimeType)
 */
export function isPdf(mimeType) {
  return mimeType === 'application/pdf';
}
