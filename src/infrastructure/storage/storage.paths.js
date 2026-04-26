// infrastructure/storage/storage.paths.js — RESQID
// Provider-agnostic path builder. Keys are pure paths — no domain, no bucket name.
// Switch R2 → S3 by changing CDN_BASE_URL and credentials only.

import crypto from 'crypto';

const year = () => new Date().getFullYear().toString();
const ts = () => Date.now();
const hex = (n = 4) => crypto.randomBytes(n).toString('hex');
const ext = contentType => {
  const map = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
  return map[contentType] ?? 'jpg';
};

export const StoragePath = {
  // schools/{schoolId}/students/{studentId}/photo/2025/{ts}-{hex}.jpg
  studentPhoto: (schoolId, studentId, contentType) =>
    `schools/${schoolId}/students/${studentId}/photo/${year()}/${ts()}-${hex()}.${ext(contentType)}`,

  // schools/{schoolId}/students/{studentId}/qr/2025/{tokenId}.png
  studentQr: (schoolId, studentId, tokenId) =>
    `schools/${schoolId}/students/${studentId}/qr/${year()}/${tokenId}.png`,

  // schools/{schoolId}/students/{studentId}/card/2025/{cardNumber}.pdf
  studentCard: (schoolId, studentId, cardNumber) =>
    `schools/${schoolId}/students/${studentId}/card/${year()}/${cardNumber}.pdf`,

  // schools/{schoolId}/bulk/2025/{orderId}/cards-batch.pdf
  bulkCards: (schoolId, orderId) => `schools/${schoolId}/bulk/${year()}/${orderId}/cards-batch.pdf`,

  // schools/{schoolId}/bulk/2025/{orderId}/manifest.json
  bulkManifest: (schoolId, orderId) =>
    `schools/${schoolId}/bulk/${year()}/${orderId}/manifest.json`,

  // schools/{schoolId}/assets/logo.png
  schoolLogo: (schoolId, contentType) => `schools/${schoolId}/assets/logo.${ext(contentType)}`,

  // schools/{schoolId}/parents/{parentId}/avatar/2025/{ts}-{hex}.jpg
  parentAvatar: (schoolId, parentId, contentType) =>
    `schools/${schoolId}/parents/${parentId}/avatar/${year()}/${ts()}-${hex()}.${ext(contentType)}`,
};

// Resolves a stored key or legacy full URL to a full public URL
export function resolveAssetUrl(keyOrUrl) {
  if (!keyOrUrl) return null;
  if (keyOrUrl.startsWith('http')) return keyOrUrl; // legacy full URL, return as-is
  return `${process.env.CDN_BASE_URL}/${keyOrUrl}`;
}
