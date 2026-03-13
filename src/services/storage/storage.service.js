// =============================================================================
// services/storage/storage.service.js — RESQID
//
// CURRENT STATE: Local filesystem stub — production-ready interface.
// Files saved to /tmp/resqid-files/ locally.
//
// PRODUCTION SWAP:
//   1. Set S3_BUCKET + AWS_REGION + AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY in .env
//   2. Uncomment S3 section below, comment out local section
//   3. Zero changes needed in any pipeline step
//
// The URL format is the same either way — only the host changes:
//   local:  http://localhost:3000/files/{key}
//   S3:     https://{bucket}.s3.{region}.amazonaws.com/{key}
//   CDN:    https://{cloudfront-id}.cloudfront.net/{key}
// =============================================================================

import fs from "fs/promises";
import path from "path";
import { ENV } from "../../config/env.js";

const LOCAL_BASE = "/tmp/resqid-files";
const LOCAL_HOST = ENV.APP_URL ?? "http://localhost:3000";

// =============================================================================
// LOCAL FILESYSTEM (current — development + pre-S3 production)
// =============================================================================

/**
 * Upload a file buffer to local filesystem.
 * Returns a public URL (served by a static middleware or presigned in future).
 *
 * @param {{ key: string, body: Buffer, contentType: string }} params
 * @returns {Promise<string>} publicUrl
 */
export const uploadFile = async ({ key, body, contentType }) => {
  const filePath = path.join(LOCAL_BASE, key);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, body);
  return `${LOCAL_HOST}/files/${key}`;
};

// Alias — must be declared AFTER uploadFile (const is not hoisted)
export const uploadBuffer = uploadFile;

/**
 * Delete a file from local filesystem.
 */
export const deleteFile = async ({ key }) => {
  try {
    const filePath = path.join(LOCAL_BASE, key);
    await fs.unlink(filePath);
  } catch {
    // Ignore if file doesn't exist
  }
};

/**
 * Generate a temporary access URL.
 * Local: same as publicUrl (no expiry).
 * S3:    generate presigned URL with expiry.
 */
export const getAccessUrl = async ({ key, expiresIn = 3600 }) => {
  return `${LOCAL_HOST}/files/${key}`;
};

// =============================================================================
// S3 (production) — uncomment and replace above when S3 is ready
// =============================================================================

/*
import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3 = new S3Client({
  region:      ENV.AWS_REGION,
  credentials: {
    accessKeyId:     ENV.AWS_ACCESS_KEY_ID,
    secretAccessKey: ENV.AWS_SECRET_ACCESS_KEY,
  },
});

const BUCKET = ENV.S3_BUCKET;
const CDN    = ENV.CLOUDFRONT_URL; // e.g. https://xxxx.cloudfront.net

export const uploadFile = async ({ key, body, contentType }) => {
  await s3.send(new PutObjectCommand({
    Bucket:      BUCKET,
    Key:         key,
    Body:        body,
    ContentType: contentType,
  }));
  return CDN ? `${CDN}/${key}` : `https://${BUCKET}.s3.${ENV.AWS_REGION}.amazonaws.com/${key}`;
};

export const uploadBuffer = uploadFile;

export const deleteFile = async ({ key }) => {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
};

export const getAccessUrl = async ({ key, expiresIn = 3600 }) => {
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  return getSignedUrl(s3, command, { expiresIn });
};
*/
