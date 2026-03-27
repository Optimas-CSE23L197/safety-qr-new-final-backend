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

/**
 * S3-compatible storage adapter (AWS SDK v3).
 * Also compatible with Cloudflare R2 via a custom endpoint.
 */
export class S3Adapter extends StorageProvider {
  constructor(config = {}) {
    super();

    this.s3 = new S3Client({
      region: config.REGION ?? process.env.AWS_REGION ?? 'auto',
      credentials: {
        accessKeyId: config.ACCESS_KEY_ID ?? process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: config.SECRET_ACCESS_KEY ?? process.env.AWS_SECRET_ACCESS_KEY,
      },
      // Set endpoint for R2 or other S3-compatible services
      ...(config.ENDPOINT || process.env.AWS_ENDPOINT
        ? { endpoint: config.ENDPOINT ?? process.env.AWS_ENDPOINT }
        : {}),
    });

    this.bucket = config.BUCKET ?? process.env.AWS_S3_BUCKET;
    this.cdnDomain = config.CDN_DOMAIN ?? process.env.AWS_CDN_DOMAIN ?? null;
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

      const location = this.cdnDomain
        ? `https://${this.cdnDomain}/${key}`
        : `https://${this.bucket}.s3.amazonaws.com/${key}`;

      console.info(`[Storage] Uploaded "${key}" — ${location}`);
      return { success: true, key, location };
    } catch (err) {
      console.error(`[Storage] Upload failed for key "${key}":`, err.message);
      throw err;
    }
  }

  async download(key) {
    try {
      const response = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      // Collect the stream into a Buffer
      const chunks = [];
      for await (const chunk of response.Body) {
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    } catch (err) {
      console.error(`[Storage] Download failed for key "${key}":`, err.message);
      throw err;
    }
  }

  async delete(key) {
    try {
      await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
      console.info(`[Storage] Deleted object "${key}".`);
    } catch (err) {
      console.error(`[Storage] Delete failed for key "${key}":`, err.message);
      throw err;
    }
  }

  async getUrl(key, expiresIn = 3600) {
    try {
      if (this.cdnDomain) {
        return `https://${this.cdnDomain}/${key}`;
      }
      return getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
        expiresIn,
      });
    } catch (err) {
      console.error(`[Storage] Failed to generate URL for key "${key}":`, err.message);
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
      console.error(`[Storage] List failed for prefix "${prefix}":`, err.message);
      throw err;
    }
  }

  /** Upload a readable stream (large files / card PDFs). */
  async uploadStream(stream, key, options = {}) {
    return this.upload(stream, key, options);
  }
}

export default S3Adapter;
