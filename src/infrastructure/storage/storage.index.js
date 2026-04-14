import crypto from 'crypto';
import { S3Adapter } from './s3.adapter.js';
import { StorageProvider } from './storage.provider.js';

// ---------------------------------------------------------------------------
// Storage Path Builders
// ---------------------------------------------------------------------------
export const StoragePath = {
  studentAvatar: studentId => `students/${studentId}/avatar.jpg`,
  studentDocuments: (studentId, filename) => `students/${studentId}/documents/${filename}`,
  schoolLogo: schoolId => `schools/${schoolId}/logo.png`,
  emergencyMedia: (tokenHash, filename) => `emergency/${tokenHash}/${filename}`,
  temp: filename => `temp/${filename}`,
  studentQrCode: studentId => `students/${studentId}/qr-code.png`,
  studentCard: studentId => `students/${studentId}/card-design.png`,
  orderInvoice: (orderId, type) => `orders/${orderId}/${type}-invoice.pdf`,
  schoolBulkExport: (schoolId, orderId) => `schools/${schoolId}/bulk-export/batch-${orderId}.pdf`,
  // NEW: Parent and student photo uploads
  studentPhoto: studentId => {
    const timestamp = Date.now();
    const random = crypto.randomBytes(8).toString('hex');
    return `students/${studentId}/photo/${timestamp}-${random}.webp`;
  },

  parentAvatar: parentId => {
    const timestamp = Date.now();
    const random = crypto.randomBytes(8).toString('hex');
    return `parents/${parentId}/avatar/${timestamp}-${random}.webp`;
  },
};

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------
let storageInstance = null;

export function initializeStorage(config = {}) {
  if (!storageInstance) {
    storageInstance = new S3Adapter(config);
  }
  return storageInstance;
}

export function getStorage() {
  if (!storageInstance) {
    throw new Error('[Storage] Not initialized. Call initializeStorage() before use.');
  }
  return storageInstance;
}

export { StorageProvider, S3Adapter };
