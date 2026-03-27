// src/utils/security/deviceFingerprint.js — NEW FILE
import crypto from 'crypto';

export const generateDeviceFingerprint = req => {
  const components = [
    req.headers['user-agent'],
    req.headers['accept-language'],
    req.headers['sec-ch-ua-platform'],
    req.ip,
  ].filter(Boolean);

  return crypto.createHash('sha256').update(components.join('|')).digest('hex');
};

export const validateDeviceFingerprint = (session, currentFingerprint) => {
  if (!session.device_fingerprint) return true; // Legacy session
  return crypto.timingSafeEqual(
    Buffer.from(session.device_fingerprint),
    Buffer.from(currentFingerprint)
  );
};
