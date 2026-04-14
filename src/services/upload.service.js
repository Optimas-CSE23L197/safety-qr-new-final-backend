// =============================================================================
// services/upload.service.js — RESQID
// Handles presigned URL generation, file validation, and upload confirmation
// =============================================================================

import crypto from 'crypto';
import { prisma } from '#config/prisma.js';
import { getStorage, StoragePath } from '#infrastructure/storage/storage.index.js';
import { redis } from '#config/redis.js';
import { logger } from '#config/logger.js';
import { ApiError } from '#shared/response/ApiError.js';

// ─── Constants ─────────────────────────────────────────────────────────────
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const UPLOAD_URL_EXPIRY = 300; // 5 minutes
const RATE_LIMIT = {
  MAX_REQUESTS: 5,
  WINDOW_SECONDS: 3600, // 1 hour
};

// ─── Validation ────────────────────────────────────────────────────────────
function validateFileUpload(contentType, fileSize) {
  if (!ALLOWED_MIME_TYPES.includes(contentType)) {
    throw ApiError.badRequest(`Invalid file type. Allowed: ${ALLOWED_MIME_TYPES.join(', ')}`);
  }

  if (fileSize > MAX_FILE_SIZE) {
    throw ApiError.badRequest(`File too large. Max size: ${MAX_FILE_SIZE / (1024 * 1024)}MB`);
  }

  return true;
}

// ─── Rate Limiting ─────────────────────────────────────────────────────────
async function checkRateLimit(identifier) {
  const key = `upload:rate:${identifier}`;
  const count = await redis.incr(key);

  if (count === 1) {
    await redis.expire(key, RATE_LIMIT.WINDOW_SECONDS);
  }

  if (count > RATE_LIMIT.MAX_REQUESTS) {
    throw ApiError.tooManyRequests(
      `Rate limit exceeded. Max ${RATE_LIMIT.MAX_REQUESTS} uploads per hour.`
    );
  }

  return true;
}

// ─── Generate Nonce for Idempotency ────────────────────────────────────────
async function generateNonce(prefix, ttl = 300) {
  const nonce = crypto.randomBytes(16).toString('hex');
  await redis.setex(`upload:nonce:${prefix}:${nonce}`, ttl, 'pending');
  return nonce;
}

async function validateNonce(prefix, nonce) {
  const key = `upload:nonce:${prefix}:${nonce}`;
  const exists = await redis.get(key);

  if (!exists) {
    throw ApiError.badRequest('Invalid or expired upload session');
  }

  await redis.del(key);
  return true;
}

// ─── Student Photo Upload ──────────────────────────────────────────────────
export async function generateStudentPhotoUploadUrl(parentId, studentId, contentType, fileSize) {
  validateFileUpload(contentType, fileSize);
  await checkRateLimit(`parent:${parentId}`);

  // 🟢 ADD: Verify parent owns this student
  const link = await prisma.parentStudent.findFirst({
    where: { parent_id: parentId, student_id: studentId },
  });

  if (!link) {
    throw ApiError.forbidden('Student not linked to this parent');
  }

  // Verify parent owns student (handled in controller, but double-check here)
  const storage = getStorage();

  // Generate unique file path
  const key = StoragePath.studentPhoto(studentId);

  // Generate presigned URL
  const { uploadUrl, publicUrl } = await storage.getPresignedUploadUrl(key, {
    contentType,
    expiresIn: UPLOAD_URL_EXPIRY,
  });

  // Generate nonce for confirmation step
  const nonce = await generateNonce(`student:${studentId}`);

  // Store upload intent in Redis for validation
  await redis.setex(
    `upload:intent:${key}`,
    UPLOAD_URL_EXPIRY + 60, // Slightly longer than URL expiry
    JSON.stringify({
      parentId,
      studentId,
      publicUrl,
      contentType,
      fileSize,
      createdAt: new Date().toISOString(),
    })
  );

  logger.info({ parentId, studentId, key }, 'Generated student photo upload URL');

  return {
    uploadUrl,
    publicUrl,
    key,
    nonce,
    expiresIn: UPLOAD_URL_EXPIRY,
    maxSize: MAX_FILE_SIZE,
    allowedTypes: ALLOWED_MIME_TYPES,
  };
}

export async function confirmStudentPhotoUpload(parentId, studentId, key, nonce) {
  // Validate nonce (prevents replay attacks)
  await validateNonce(`student:${studentId}`, nonce);

  // Retrieve upload intent
  const intentData = await redis.get(`upload:intent:${key}`);
  if (!intentData) {
    throw ApiError.badRequest('Upload session expired or invalid');
  }

  const intent = JSON.parse(intentData);

  // Verify ownership matches
  if (intent.parentId !== parentId || intent.studentId !== studentId) {
    throw ApiError.forbidden('Unauthorized upload confirmation');
  }

  // Verify file actually exists in R2
  const storage = getStorage();
  const exists = await storage.exists(key);

  if (!exists) {
    throw ApiError.badRequest('File not found. Upload may have failed.');
  }

  // Clean up Redis
  await redis.del(`upload:intent:${key}`);

  logger.info({ parentId, studentId, key }, 'Confirmed student photo upload');

  return {
    photoUrl: intent.publicUrl,
    verified: true,
  };
}

// ─── Parent Avatar Upload ──────────────────────────────────────────────────
export async function generateParentAvatarUploadUrl(parentId, contentType, fileSize) {
  // Validate inputs
  validateFileUpload(contentType, fileSize);
  await checkRateLimit(`parent:${parentId}`);

  const storage = getStorage();

  // Generate unique file path
  const key = StoragePath.parentAvatar(parentId);

  // Generate presigned URL
  const { uploadUrl, publicUrl } = await storage.getPresignedUploadUrl(key, {
    contentType,
    expiresIn: UPLOAD_URL_EXPIRY,
  });

  // Generate nonce for confirmation step
  const nonce = await generateNonce(`avatar:${parentId}`);

  // Store upload intent in Redis
  await redis.setex(
    `upload:intent:${key}`,
    UPLOAD_URL_EXPIRY + 60,
    JSON.stringify({
      parentId,
      publicUrl,
      contentType,
      fileSize,
      createdAt: new Date().toISOString(),
    })
  );

  logger.info({ parentId, key }, 'Generated parent avatar upload URL');

  return {
    uploadUrl,
    publicUrl,
    key,
    nonce,
    expiresIn: UPLOAD_URL_EXPIRY,
    maxSize: MAX_FILE_SIZE,
    allowedTypes: ALLOWED_MIME_TYPES,
  };
}

export async function confirmParentAvatarUpload(parentId, key, nonce) {
  // Validate nonce
  await validateNonce(`avatar:${parentId}`, nonce);

  // Retrieve upload intent
  const intentData = await redis.get(`upload:intent:${key}`);
  if (!intentData) {
    throw ApiError.badRequest('Upload session expired or invalid');
  }

  const intent = JSON.parse(intentData);

  // Verify ownership
  if (intent.parentId !== parentId) {
    throw ApiError.forbidden('Unauthorized upload confirmation');
  }

  // Verify file exists in R2
  const storage = getStorage();
  const exists = await storage.exists(key);

  if (!exists) {
    throw ApiError.badRequest('File not found. Upload may have failed.');
  }

  // Clean up Redis
  await redis.del(`upload:intent:${key}`);

  logger.info({ parentId, key }, 'Confirmed parent avatar upload');

  return {
    avatarUrl: intent.publicUrl,
    verified: true,
  };
}
