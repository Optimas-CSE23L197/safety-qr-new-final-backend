// =============================================================================
// s3.js — RESQID
// AWS S3 client for QR asset and card file storage
//
// Schema references:
//   QrAsset.storage_key  — S3 object key (path in bucket)
//   QrAsset.public_url   — CDN-fronted public URL
//   Card.file_url        — S3/CDN URL for physical card print files
//
// Features:
//   - Single S3Client instance (AWS SDK v3 — modular, tree-shakeable)
//   - Local dev: MinIO-compatible via AWS_S3_ENDPOINT override
//   - Presigned URL generation for secure direct uploads from frontend
//   - Presigned URL generation for secure private downloads
//   - Automatic content-type detection
//   - Health check via HeadBucket
// =============================================================================

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  CopyObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ENV } from "./env.js";
import { logger } from "./logger.js";

// ─── S3 Client Singleton ──────────────────────────────────────────────────────

const s3Config = {
  region: ENV.AWS_REGION,
  credentials: {
    accessKeyId: ENV.AWS_ACCESS_KEY_ID,
    secretAccessKey: ENV.AWS_SECRET_ACCESS_KEY,
  },
  // MinIO / local S3-compatible override
  ...(ENV.AWS_S3_ENDPOINT && {
    endpoint: ENV.AWS_S3_ENDPOINT,
    forcePathStyle: true, // required for MinIO
  }),
};

export const s3 = new S3Client(s3Config);
export const BUCKET = ENV.AWS_S3_BUCKET;

// ─── Key Namespacing ──────────────────────────────────────────────────────────
// Consistent S3 key prefixes — keep assets organized in the bucket
// Matches how QrAsset.storage_key should be constructed

export const S3_PREFIXES = Object.freeze({
  QR: "qr/", // QrAsset — QR code images
  CARD: "cards/", // Card — print-ready card files
  LOGO: "logos/", // School logos
  PHOTO: "photos/", // Student photos
  INVOICE: "invoices/", // Invoice PDFs
  TEMPLATE: "templates/", // Card template files
});

// ─── Upload ───────────────────────────────────────────────────────────────────

/**
 * uploadFile(key, body, options)
 * Upload a file buffer or stream to S3
 *
 * @param {string} key       - S3 object key (e.g. "qr/school-id/token-hash.png")
 * @param {Buffer|Readable}  body - File content
 * @param {object} options
 * @param {string} options.contentType - MIME type (e.g. "image/png")
 * @param {string} [options.acl]      - S3 ACL ("private" | "public-read") — default: private
 * @param {object} [options.metadata] - Custom S3 metadata key-value pairs
 * @returns {string} The S3 key of the uploaded object
 */
export async function uploadFile(key, body, options = {}) {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: body,
    ContentType: options.contentType ?? "application/octet-stream",
    // Default to private — use presigned URLs for client access
    ACL: options.acl ?? "private",
    ...(options.metadata && { Metadata: options.metadata }),
    // Server-side encryption — always encrypt at rest
    ServerSideEncryption: "AES256",
  });

  await s3.send(command);

  logger.info(
    { type: "s3_upload", key, bucket: BUCKET },
    `S3: uploaded ${key}`,
  );

  return key;
}

// ─── Download ─────────────────────────────────────────────────────────────────

/**
 * getFileBuffer(key)
 * Download a file from S3 as a Buffer
 * Use for server-side processing (PDF generation, image resize, etc.)
 */
export async function getFileBuffer(key) {
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  const response = await s3.send(command);

  // Stream to buffer
  const chunks = [];
  for await (const chunk of response.Body) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// ─── Delete ───────────────────────────────────────────────────────────────────

/**
 * deleteFile(key)
 * Permanently delete an object from S3
 * Called when: student deleted, token revoked, card template replaced
 */
export async function deleteFile(key) {
  const command = new DeleteObjectCommand({ Bucket: BUCKET, Key: key });
  await s3.send(command);

  logger.info({ type: "s3_delete", key, bucket: BUCKET }, `S3: deleted ${key}`);
}

// ─── Copy (for template duplication) ─────────────────────────────────────────

/**
 * copyFile(sourceKey, destKey)
 * Server-side copy — no download/re-upload required
 * Used for: duplicating card templates
 */
export async function copyFile(sourceKey, destKey) {
  const command = new CopyObjectCommand({
    Bucket: BUCKET,
    CopySource: `${BUCKET}/${sourceKey}`,
    Key: destKey,
    ServerSideEncryption: "AES256",
  });
  await s3.send(command);
  return destKey;
}

// ─── Presigned URLs ───────────────────────────────────────────────────────────

/**
 * getPresignedUploadUrl(key, contentType, expiresIn)
 * Generate a presigned PUT URL for direct browser-to-S3 upload
 * Frontend uploads directly — server never handles the file bytes
 *
 * @param {string} key         - Target S3 key
 * @param {string} contentType - Expected MIME type (enforced by S3)
 * @param {number} expiresIn   - URL validity in seconds (default: 5 min)
 * @returns {string} Presigned PUT URL
 */
export async function getPresignedUploadUrl(key, contentType, expiresIn = 300) {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: contentType,
    ServerSideEncryption: "AES256",
  });

  return getSignedUrl(s3, command, { expiresIn });
}

/**
 * getPresignedDownloadUrl(key, expiresIn)
 * Generate a presigned GET URL for temporary file access
 * Use for: invoice PDFs, card file downloads, private student photos
 *
 * @param {string} key       - S3 object key
 * @param {number} expiresIn - URL validity in seconds (default: 15 min)
 * @returns {string} Presigned GET URL
 */
export async function getPresignedDownloadUrl(key, expiresIn = 900) {
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  return getSignedUrl(s3, command, { expiresIn });
}

// ─── Public CDN URL Builder ───────────────────────────────────────────────────

/**
 * buildCdnUrl(key)
 * Constructs the public CDN URL for a given S3 key
 * Only valid for objects with ACL public-read (QR PNGs, school logos)
 * Stored as QrAsset.public_url
 */
export function buildCdnUrl(key) {
  const base = ENV.CDN_URL.replace(/\/$/, "");
  return `${base}/${key}`;
}

// ─── Existence Check ──────────────────────────────────────────────────────────

/**
 * fileExists(key)
 * Check if an S3 object exists without downloading it
 */
export async function fileExists(key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch (err) {
    if (err.name === "NotFound" || err.$metadata?.httpStatusCode === 404) {
      return false;
    }
    throw err;
  }
}

// ─── Health Check ─────────────────────────────────────────────────────────────

export async function checkS3Health() {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: BUCKET }));
    return { status: "ok", bucket: BUCKET };
  } catch (err) {
    logger.error(
      { type: "s3_health_check", err: err.message },
      "S3 health check failed",
    );
    return { status: "error", error: err.message };
  }
}
