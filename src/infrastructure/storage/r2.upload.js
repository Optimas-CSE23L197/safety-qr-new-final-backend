// src/infrastructure/storage/r2.upload.js
// Cloudflare R2 upload utilities
// Implements Rule 7: R2 NOT S3
// ES6 Module syntax

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ENV } from '#config/env.js';
import logger from '#config/logger.js';

// Singleton R2 client instance
let r2Client = null;

/**
 * Initialize R2 client with Cloudflare endpoint
 * Uses R2-specific config from ENV
 */
export const getR2Client = () => {
  if (r2Client) return r2Client;

  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME } = ENV;

  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME) {
    throw new Error(
      'Missing R2 configuration. Required: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME'
    );
  }

  r2Client = new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
    forcePathStyle: true, // Required for R2
  });

  logger.info('R2 client initialized', {
    bucket: R2_BUCKET_NAME,
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  });

  return r2Client;
};

/**
 * Upload buffer to R2
 * @param {Object} params - Upload parameters
 * @param {Buffer} params.buffer - File buffer to upload
 * @param {string} params.key - S3/R2 object key (path)
 * @param {string} params.contentType - MIME type (e.g., 'image/png', 'application/pdf')
 * @param {Object} params.metadata - Optional metadata
 * @returns {Promise<{ url: string, key: string, bucket: string }>}
 */
export const uploadBuffer = async ({ buffer, key, contentType, metadata = {} }) => {
  const client = getR2Client();
  const { R2_BUCKET_NAME, R2_PUBLIC_URL } = ENV;

  if (!R2_BUCKET_NAME) {
    throw new Error('R2_BUCKET_NAME is not configured');
  }

  const command = new PutObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: contentType,
    Metadata: metadata,
  });

  try {
    await client.send(command);

    // Use R2_PUBLIC_URL if provided, otherwise construct from account ID
    const publicUrl = R2_PUBLIC_URL
      ? `${R2_PUBLIC_URL}/${key}`
      : `https://${R2_BUCKET_NAME}.${ENV.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${key}`;

    logger.debug('R2 upload successful', { key, contentType, size: buffer.length });

    return {
      url: publicUrl,
      key,
      bucket: R2_BUCKET_NAME,
    };
  } catch (error) {
    logger.error('R2 upload failed', { key, error: error.message });
    throw new Error(`R2 upload failed: ${error.message}`);
  }
};

/**
 * Generate a pre-signed URL for temporary access (useful for private files)
 * @param {string} key - Object key
 * @param {number} expiresIn - Expiration time in seconds (default 3600)
 * @returns {Promise<string>}
 */
export const getSignedUrlForDownload = async (key, expiresIn = 3600) => {
  const client = getR2Client();
  const { R2_BUCKET_NAME } = ENV;

  const command = new GetObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: key,
  });

  try {
    const signedUrl = await getSignedUrl(client, command, { expiresIn });
    return signedUrl;
  } catch (error) {
    logger.error('Failed to generate signed URL', { key, error: error.message });
    throw new Error(`Failed to generate signed URL: ${error.message}`);
  }
};

/**
 * Check if object exists in R2
 * @param {string} key - Object key
 * @returns {Promise<boolean>}
 */
export const objectExists = async key => {
  const client = getR2Client();
  const { R2_BUCKET_NAME } = ENV;

  try {
    const command = new HeadObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
    });

    await client.send(command);
    return true;
  } catch (error) {
    if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
      return false;
    }
    logger.error('R2 existence check failed', { key, error: error.message });
    throw error;
  }
};

/**
 * Generate R2 key for QR code
 * @param {string} schoolId - School ID
 * @param {string} studentId - Student ID
 * @returns {string}
 */
export const getQrCodeKey = (schoolId, studentId) => {
  return `qr-codes/${schoolId}/${studentId}.png`;
};

/**
 * Generate R2 key for card design
 * @param {string} schoolId - School ID
 * @param {string} studentId - Student ID
 * @returns {string}
 */
export const getCardDesignKey = (schoolId, studentId) => {
  return `card-designs/${schoolId}/${studentId}.png`;
};

/**
 * Generate R2 key for invoice
 * @param {string} schoolId - School ID
 * @param {string} invoiceNumber - Invoice number
 * @param {string} type - 'partial' or 'final'
 * @returns {string}
 */
export const getInvoiceKey = (schoolId, invoiceNumber, type) => {
  return `invoices/${schoolId}/${type}-${invoiceNumber}.pdf`;
};

/**
 * Upload QR code PNG buffer
 * @param {Object} params
 * @param {Buffer} params.buffer - QR code PNG buffer
 * @param {string} params.schoolId
 * @param {string} params.studentId
 * @returns {Promise<{ url: string, key: string }>}
 */
export const uploadQrCode = async ({ buffer, schoolId, studentId }) => {
  const key = getQrCodeKey(schoolId, studentId);
  return uploadBuffer({
    buffer,
    key,
    contentType: 'image/png',
    metadata: {
      type: 'qr-code',
      schoolId,
      studentId,
    },
  });
};

/**
 * Upload card design PNG buffer
 * @param {Object} params
 * @param {Buffer} params.buffer - Card design PNG buffer
 * @param {string} params.schoolId
 * @param {string} params.studentId
 * @param {string} params.cardNumber
 * @returns {Promise<{ url: string, key: string }>}
 */
export const uploadCardDesign = async ({ buffer, schoolId, studentId, cardNumber }) => {
  const key = getCardDesignKey(schoolId, studentId);
  return uploadBuffer({
    buffer,
    key,
    contentType: 'image/png',
    metadata: {
      type: 'card-design',
      schoolId,
      studentId,
      cardNumber,
    },
  });
};

/**
 * Upload invoice PDF
 * @param {Object} params
 * @param {Buffer} params.buffer - PDF buffer
 * @param {string} params.schoolId
 * @param {string} params.invoiceNumber
 * @param {string} params.type - 'partial' or 'final'
 * @returns {Promise<{ url: string, key: string }>}
 */
export const uploadInvoice = async ({ buffer, schoolId, invoiceNumber, type }) => {
  const key = getInvoiceKey(schoolId, invoiceNumber, type);
  return uploadBuffer({
    buffer,
    key,
    contentType: 'application/pdf',
    metadata: {
      type: 'invoice',
      invoiceType: type,
      schoolId,
      invoiceNumber,
    },
  });
};

// Default export for convenience
export default {
  getR2Client,
  uploadBuffer,
  getSignedUrlForDownload,
  objectExists,
  getQrCodeKey,
  getCardDesignKey,
  getInvoiceKey,
  uploadQrCode,
  uploadCardDesign,
  uploadInvoice,
};
