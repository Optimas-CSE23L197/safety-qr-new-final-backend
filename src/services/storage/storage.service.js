// =============================================================================
// services/storage/storage.service.js — RESQID
//
// STORAGE BACKEND — controlled by STORAGE_DRIVER env var:
//
//   STORAGE_DRIVER=local  → local filesystem (/tmp/resqid-files)   [default]
//   STORAGE_DRIVER=s3     → AWS S3 + CloudFront CDN  (via config/s3.js)
//
// ─── Required .env keys for S3 ───────────────────────────────────────────────
//   STORAGE_DRIVER=s3
//   AWS_REGION=ap-south-1
//   AWS_ACCESS_KEY_ID=AKIAxxxxxxxxxxxxxxxx
//   AWS_SECRET_ACCESS_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
//   AWS_S3_BUCKET=your-bucket-name
//   CDN_URL=https://xxxx.cloudfront.net      ← required for public card/QR URLs
//   AWS_S3_ENDPOINT=http://localhost:9000    ← optional, MinIO local dev only
//
// ─── URL strategy ────────────────────────────────────────────────────────────
//   uploadFile()   → public CDN URL via buildCdnUrl()   (stored in DB)
//   getAccessUrl() → presigned S3 URL                   (temporary download)
//   deleteFile()   → permanent S3 delete
//
// ─── Caller interface (unchanged from local stub) ────────────────────────────
//   uploadFile({ key, body, contentType })  → Promise<string>  publicUrl
//   uploadBuffer({ key, body, contentType}) → alias of uploadFile
//   deleteFile({ key })                     → Promise<void>
//   getAccessUrl({ key, expiresIn? })       → Promise<string>  presignedUrl
//
// Zero changes needed in step5_design.js, qr_service.js, or any pipeline step.
// =============================================================================

import fs from "fs/promises";
import path from "path";
import { ENV } from "../../config/env.js";

// s3.js exports — only used when STORAGE_DRIVER=s3
import {
  uploadFile as s3Upload,
  deleteFile as s3Delete,
  getPresignedDownloadUrl,
  buildCdnUrl,
} from "../../config/s3.js";

const driver = () => (ENV.STORAGE_DRIVER ?? "local").trim().toLowerCase();

// =============================================================================
// LOCAL DRIVER — development / pre-S3
// =============================================================================

const LOCAL_BASE = "/tmp/resqid-files";
const LOCAL_HOST = (ENV.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

const localDriver = {
  async uploadFile({ key, body, contentType }) {
    const filePath = path.join(LOCAL_BASE, key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, body);
    return `${LOCAL_HOST}/files/${key}`;
  },

  async deleteFile({ key }) {
    try {
      await fs.unlink(path.join(LOCAL_BASE, key));
    } catch {
      // ignore — file may not exist
    }
  },

  async getAccessUrl({ key }) {
    // No expiry concept locally — same URL always
    return `${LOCAL_HOST}/files/${key}`;
  },
};

// =============================================================================
// S3 DRIVER — production (AWS S3 + CloudFront)
// =============================================================================
//
// s3.js uploadFile(key, body, { contentType, acl, metadata })
//   → private by default (ACL: "private") + AES256 encryption
//   → returns the S3 key (NOT the URL)
//
// We call buildCdnUrl(key) → ENV.CDN_URL + "/" + key for the public URL.
//
// CloudFront setup:
//   - Bucket stays PRIVATE (no public-read ACL needed)
//   - CloudFront serves files via OAC (Origin Access Control)
//   - Only CloudFront can read from the bucket — secure by default
//
// If you're NOT using OAC (bucket is public-read), uncomment:
//   acl: "public-read"   in the uploadFile call below
//
// =============================================================================

const s3Driver = {
  /**
   * Upload a Buffer to S3, return the CloudFront CDN public URL.
   * Stored in: QrAsset.public_url, Card.file_url
   *
   * @param {{ key: string, body: Buffer, contentType: string }} params
   * @returns {Promise<string>} CloudFront URL
   */
  async uploadFile({ key, body, contentType }) {
    // s3.js signature: uploadFile(key, body, options)
    await s3Upload(key, body, {
      contentType,
      // acl: "public-read",  // uncomment ONLY if NOT using CloudFront OAC
    });

    // buildCdnUrl → ENV.CDN_URL + "/" + key
    return buildCdnUrl(key);
  },

  /**
   * Delete an object from S3.
   * Called on: token revoke, card void, order cancel.
   */
  async deleteFile({ key }) {
    await s3Delete(key);
  },

  /**
   * Presigned S3 GET URL for temporary private access.
   * Use for: admin download links, invoice PDFs.
   * Do NOT use for CDN-served card/QR images — just use uploadFile's URL for those.
   *
   * @param {{ key: string, expiresIn?: number }} params
   * @returns {Promise<string>} presigned URL
   */
  async getAccessUrl({ key, expiresIn = 3600 }) {
    return getPresignedDownloadUrl(key, expiresIn);
  },
};

// =============================================================================
// DRIVER SELECTOR
// =============================================================================

const getDriver = () => {
  const d = driver();
  if (d === "s3") return s3Driver;
  if (d === "local") return localDriver;
  console.warn(
    `[storage.service] Unknown STORAGE_DRIVER="${d}", falling back to local`,
  );
  return localDriver;
};

// =============================================================================
// PUBLIC API
// Identical interface regardless of driver — callers never change.
// =============================================================================

/**
 * Upload a file buffer to storage.
 * Returns a public URL (CloudFront for S3, localhost for local).
 *
 * Callers:
 *   step4_generate.js  → QR PNG  → QrAsset.public_url
 *   step5_design.js    → card PNG → Card.file_url
 *
 * @param {{ key: string, body: Buffer, contentType: string }} params
 * @returns {Promise<string>} publicUrl
 */
export const uploadFile = async ({ key, body, contentType }) => {
  return getDriver().uploadFile({ key, body, contentType });
};

// Alias for any callers using uploadBuffer
export const uploadBuffer = uploadFile;

/**
 * Delete a file from storage.
 *
 * @param {{ key: string }} params
 */
export const deleteFile = async ({ key }) => {
  return getDriver().deleteFile({ key });
};

/**
 * Get a temporary access URL.
 * S3:    presigned GET URL (expires after expiresIn seconds)
 * local: static URL (no expiry)
 *
 * @param {{ key: string, expiresIn?: number }} params
 * @returns {Promise<string>}
 */
export const getAccessUrl = async ({ key, expiresIn = 3600 }) => {
  return getDriver().getAccessUrl({ key, expiresIn });
};
