import { logger } from '#config/logger.js';

export const formatAmount = paise => `₹${((paise ?? 0) / 100).toFixed(0)}`;
export const formatDate = date =>
  date
    ? new Date(date).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
    : null;

export const daysUntil = date => {
  if (!date) return null;
  return Math.ceil((new Date(date) - Date.now()) / 86_400_000);
};

export const extractExpoTokens = devices =>
  (devices ?? []).map(d => d.expo_push_token).filter(Boolean);

export const safePublish = async (fn, label) => {
  try {
    return await fn();
  } catch (err) {
    logger.warn({ err: err.message, label }, '[notification.module] Publish failed — skipping');
  }
};
