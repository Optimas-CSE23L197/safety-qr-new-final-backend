// =============================================================================
// services/upload.service.js — RESQID
// Handles presigned URL generation, file validation, and upload confirmation
// =============================================================================

import crypto from 'crypto';
import { prisma } from '#config/prisma.js';
import { StoragePath, resolveAssetUrl } from '#infrastructure/storage/storage.paths.js';
import { getStorage } from '#infrastructure/storage/storage.index.js';
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

  const link = await prisma.parentStudent.findFirst({
    where: { parent_id: parentId, student_id: studentId },
    include: { student: { select: { school_id: true } } },
  });
  if (!link) throw ApiError.forbidden('Student not linked to this parent');

  const schoolId = link.student?.school_id;
  if (!schoolId) throw ApiError.badRequest('Student has no school assigned');

  const storage = getStorage();
  const key = StoragePath.studentPhoto(schoolId, studentId, contentType); // ✅ school-scoped + year

  const { uploadUrl, publicUrl } = await storage.getPresignedUploadUrl(key, {
    contentType,
    expiresIn: UPLOAD_URL_EXPIRY,
  });

  const nonce = crypto.randomBytes(16).toString('hex');
  await redis.setex(`upload:nonce:student:${studentId}:${nonce}`, UPLOAD_URL_EXPIRY, 'pending');

  await redis.setex(
    `upload:intent:${key}`,
    UPLOAD_URL_EXPIRY + 60,
    JSON.stringify({
      parentId,
      studentId,
      schoolId,
      publicUrl,
      contentType,
      fileSize,
      createdAt: new Date().toISOString(),
    })
  );

  logger.info({ parentId, studentId, schoolId, key }, 'Generated student photo upload URL');

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
  await validateNonce(`student:${studentId}`, nonce);

  const intentData = await redis.get(`upload:intent:${key}`);
  if (!intentData) throw ApiError.badRequest('Upload session expired or invalid');

  const intent = JSON.parse(intentData);
  if (intent.parentId !== parentId || intent.studentId !== studentId)
    throw ApiError.forbidden('Unauthorized upload confirmation');

  const storage = getStorage();
  const exists = await storage.exists(key);
  if (!exists) throw ApiError.badRequest('File not found. Upload may have failed.');

  await redis.del(`upload:intent:${key}`);

  const photoUrl = `${process.env.CDN_BASE_URL}/${key}`; // ✅ full URL stored in DB

  // ✅ Save to DB directly here
  await prisma.student.update({
    where: { id: studentId },
    data: { photo_url: photoUrl },
  });

  logger.info({ parentId, studentId, key }, 'Confirmed student photo upload');
  return { photoUrl, verified: true };
}

// ─── Parent Avatar Upload ──────────────────────────────────────────────────
export async function generateParentAvatarUploadUrl(parentId, contentType, fileSize) {
  validateFileUpload(contentType, fileSize);
  await checkRateLimit(`parent:${parentId}`);

  // Get any linked student to find schoolId
  const link = await prisma.parentStudent.findFirst({
    where: { parent_id: parentId },
    include: { student: { select: { school_id: true } } },
  });
  const schoolId = link?.student?.school_id ?? 'unassigned';

  const storage = getStorage();
  const key = StoragePath.parentAvatar(schoolId, parentId, contentType); // ✅ school-scoped + year

  const { uploadUrl, publicUrl } = await storage.getPresignedUploadUrl(key, {
    contentType,
    expiresIn: UPLOAD_URL_EXPIRY,
  });

  const nonce = crypto.randomBytes(16).toString('hex');
  await redis.setex(`upload:nonce:avatar:${parentId}:${nonce}`, UPLOAD_URL_EXPIRY, 'pending');

  await redis.setex(
    `upload:intent:${key}`,
    UPLOAD_URL_EXPIRY + 60,
    JSON.stringify({
      parentId,
      schoolId,
      publicUrl,
      contentType,
      fileSize,
      createdAt: new Date().toISOString(),
    })
  );

  logger.info({ parentId, schoolId, key }, 'Generated parent avatar upload URL');
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
  await validateNonce(`avatar:${parentId}`, nonce);

  const intentData = await redis.get(`upload:intent:${key}`);
  if (!intentData) throw ApiError.badRequest('Upload session expired or invalid');

  const intent = JSON.parse(intentData);
  if (intent.parentId !== parentId) throw ApiError.forbidden('Unauthorized upload confirmation');

  const storage = getStorage();
  const exists = await storage.exists(key);
  if (!exists) throw ApiError.badRequest('File not found. Upload may have failed.');

  await redis.del(`upload:intent:${key}`);

  const avatarUrl = `${process.env.CDN_BASE_URL}/${key}`; // ✅ full URL stored in DB

  // ✅ Save to DB directly here
  await prisma.parentUser.update({
    where: { id: parentId },
    data: { avatar_url: avatarUrl },
  });

  logger.info({ parentId, key }, 'Confirmed parent avatar upload');
  return { avatarUrl, verified: true };
}
