import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { StorageProvider } from './storage.provider.js';
import { logger } from '#config/logger.js';

export class S3Adapter extends StorageProvider {
  constructor(config = {}) {
    super();

    this.endpoint = config.ENDPOINT ?? process.env.AWS_S3_ENDPOINT;
    this.region = config.REGION ?? process.env.AWS_REGION ?? 'auto';
    this.bucket = config.BUCKET ?? process.env.AWS_S3_BUCKET;
    this.cdnDomain = config.CDN_DOMAIN ?? process.env.AWS_CDN_DOMAIN ?? null;

    this.s3 = new S3Client({
      region: this.region,
      credentials: {
        accessKeyId: config.ACCESS_KEY_ID ?? process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: config.SECRET_ACCESS_KEY ?? process.env.AWS_SECRET_ACCESS_KEY,
      },
      ...(this.endpoint ? { endpoint: this.endpoint } : {}),
      forcePathStyle: true, // required for R2
    });
  }

  async upload(file, key, options = {}) {
    try {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: file,
          ContentType: options.contentType ?? 'application/octet-stream',
          Metadata: options.metadata ?? {},
          ...(options.cacheControl ? { CacheControl: options.cacheControl } : {}),
        })
      );

      // In upload method - update location URL construction
      const location = this.cdnDomain
        ? `https://${this.cdnDomain}/${key}`
        : this.endpoint
          ? `https://${this.endpoint}/${this.bucket}/${key}`
          : `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`;

      logger.info({ key, location }, `[Storage] Uploaded "${key}"`);
      return { success: true, key, location };
    } catch (err) {
      logger.error({ err: err.message, key }, `[Storage] Upload failed for key "${key}"`);
      throw err;
    }
  }

  async download(key) {
    try {
      const response = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      const chunks = [];
      for await (const chunk of response.Body) {
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    } catch (err) {
      logger.error({ err: err.message, key }, `[Storage] Download failed for key "${key}"`);
      throw err;
    }
  }

  async delete(key) {
    try {
      await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
      logger.info({ key }, `[Storage] Deleted object "${key}"`);
    } catch (err) {
      logger.error({ err: err.message, key }, `[Storage] Delete failed for key "${key}"`);
      throw err;
    }
  }

  // In getUrl method - replace the AWS-style fallback with R2-style
  async getUrl(key, expiresIn = 3600) {
    try {
      if (this.cdnDomain) {
        return `https://${this.cdnDomain}/${key}`;
      }
      if (this.endpoint) {
        return `https://${this.endpoint}/${this.bucket}/${key}`;
      }
      return getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
        expiresIn,
      });
    } catch (err) {
      logger.error({ err: err.message, key }, `[Storage] Failed to generate URL for key "${key}"`);
      throw err;
    }
  }

  async exists(key) {
    try {
      await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch (err) {
      if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
        return false;
      }
      throw err;
    }
  }

  async list(prefix, options = {}) {
    try {
      const response = await this.s3.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          MaxKeys: options.limit ?? 1000,
        })
      );

      return (response.Contents ?? []).map(item => ({
        key: item.Key,
        size: item.Size,
        lastModified: item.LastModified,
        etag: item.ETag,
      }));
    } catch (err) {
      logger.error({ err: err.message, prefix }, `[Storage] List failed for prefix "${prefix}"`);
      throw err;
    }
  }

  async uploadStream(stream, key, options = {}) {
    return this.upload(stream, key, options);
  }

  // Add to s3.adapter.js after getUrl() method

  async getPresignedUploadUrl(key, options = {}) {
    const {
      contentType = 'application/octet-stream',
      expiresIn = 300, // 5 minutes
      cacheControl = 'public, max-age=31536000, immutable',
    } = options;

    try {
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
        CacheControl: cacheControl,
      });

      const uploadUrl = await getSignedUrl(this.s3, command, { expiresIn });

      const publicUrl = this.cdnDomain
        ? `https://${this.cdnDomain}/${key}`
        : `${this.endpoint}/${this.bucket}/${key}`;

      return { uploadUrl, publicUrl, key, expiresIn };
    } catch (err) {
      logger.error(
        { err: err.message, key },
        `[Storage] Failed to generate upload URL for "${key}"`
      );
      throw err;
    }
  }
}

export default S3Adapter;
