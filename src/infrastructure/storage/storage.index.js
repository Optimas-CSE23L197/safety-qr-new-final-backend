import crypto from 'crypto';
import { S3Adapter } from './s3.adapter.js';
import { StorageProvider } from './storage.provider.js';

// ---------------------------------------------------------------------------
// Storage Path Builders — ORGANIZED BY SCHOOL FIRST
// ---------------------------------------------------------------------------
export const StoragePath = {
  // STUDENTS — nested under school_id
  studentQrCode: (schoolId, studentId) => `students/${schoolId}/${studentId}/qr-code.png`,
  studentPhoto: (schoolId, studentId) => {
    const timestamp = Date.now();
    const random = crypto.randomBytes(8).toString('hex');
    return `students/${schoolId}/${studentId}/photo/${timestamp}-${random}.webp`;
  },
  studentAvatar: (schoolId, studentId) => `students/${schoolId}/${studentId}/avatar.jpg`,
  studentCard: (schoolId, studentId) => `students/${schoolId}/${studentId}/card-design.png`,
  studentDocuments: (schoolId, studentId, filename) =>
    `students/${schoolId}/${studentId}/documents/${filename}`,

  // SCHOOLS
  schoolLogo: schoolId => `schools/${schoolId}/logo.png`,
  schoolBulkExport: (schoolId, orderId) => `schools/${schoolId}/bulk-exports/order-${orderId}.pdf`,

  // ORDERS
  orderInvoice: (orderId, type) => `orders/${orderId}/invoices/${type}-invoice.pdf`,
  orderCardPdf: orderId => `orders/${orderId}/cards.pdf`,

  // CARDS (individual card designs)
  cardDesign: cardId => `cards/${cardId}/design.pdf`,

  // PARENTS
  parentAvatar: parentId => {
    const timestamp = Date.now();
    const random = crypto.randomBytes(8).toString('hex');
    return `parents/${parentId}/avatar/${timestamp}-${random}.webp`;
  },

  // EMERGENCY
  emergencyMedia: (tokenHash, filename) => `emergency/${tokenHash}/${filename}`,

  // TEMP
  temp: filename => `temp/${filename}`,

  // SYSTEM
  systemAsset: filename => `system/${filename}`,
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
