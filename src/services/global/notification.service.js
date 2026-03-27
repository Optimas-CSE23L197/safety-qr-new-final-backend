// =============================================================================
// services/global/notification.service.js — RESQID
// GLOBAL NOTIFICATION BASE SERVICE
// Provides low-level send functions for SMS, Email, Push
// Each module imports this and builds its own notifications
// =============================================================================

import { ENV } from '#config/env.js';
import { logger } from '#config/logger.js';
import { sendSms } from '#integrations/sms/sms.service.js';
import { sendEmail } from '#integrations/email/email.service.js';
import { sendMulticast } from '#config/firebase.js';
import { prisma } from '#config/database/prisma.js';

// =============================================================================
// LOW-LEVEL SEND FUNCTIONS
// =============================================================================

/**
 * Send SMS - handles dev mode logging
 */
export async function sendSmsNotification(phone, message, context = {}) {
  const isDev = ENV.IS_DEV;

  if (isDev) {
    logger.info(
      {
        type: 'sms_dev_mock',
        phone,
        message,
        ...context,
      },
      `[DEV] SMS to ${phone}: ${message}`
    );
    return { success: true, mode: 'mock' };
  }

  try {
    const result = await sendSms(phone, message);
    return { success: true, mode: 'live', requestId: result.requestId };
  } catch (error) {
    logger.error({ error: error.message, phone, ...context }, 'SMS send failed');
    return { success: false, error: error.message };
  }
}

/**
 * Send Email - handles dev mode logging
 */
export async function sendEmailNotification(to, subject, html, context = {}) {
  const isDev = ENV.IS_DEV;

  if (isDev) {
    logger.info(
      {
        type: 'email_dev_mock',
        to,
        subject,
        ...context,
      },
      `[DEV] Email to ${to}: ${subject}`
    );
    return { success: true, mode: 'mock' };
  }

  try {
    const result = await sendEmail({ to, subject, html });
    return { success: true, mode: 'live', messageId: result.messageId };
  } catch (error) {
    logger.error({ error: error.message, to, ...context }, 'Email send failed');
    return { success: false, error: error.message };
  }
}

/**
 * Send Push Notification - handles dev mode logging
 */
export async function sendPushNotification(parentId, title, body, data = {}, context = {}) {
  const isDev = ENV.IS_DEV;

  // Get active devices for parent
  const devices = await prisma.parentDevice.findMany({
    where: { parent_id: parentId, is_active: true },
    select: { device_token: true, platform: true },
  });

  if (!devices.length) {
    logger.info({ parentId, ...context }, 'No active devices for push');
    return { success: false, error: 'No active devices' };
  }

  const tokens = devices.map(d => d.device_token);

  if (isDev) {
    logger.info(
      {
        type: 'push_dev_mock',
        parentId,
        devices: tokens.length,
        title,
        body,
        ...context,
      },
      `[DEV] Push to ${tokens.length} devices: ${title}`
    );
    return { success: true, mode: 'mock', devices: tokens.length };
  }

  try {
    const result = await sendMulticast(
      tokens,
      { title, body: body.length > 100 ? body.slice(0, 97) + '...' : body },
      { type: 'notification', ...data }
    );
    return { success: true, mode: 'live', successCount: result.successCount };
  } catch (error) {
    logger.error({ error: error.message, parentId, ...context }, 'Push send failed');
    return { success: false, error: error.message };
  }
}

/**
 * Get user contact info
 */
export async function getUserContact(userId, userType) {
  if (userType === 'PARENT_USER') {
    return prisma.parentUser.findUnique({
      where: { id: userId },
      select: { email: true, phone: true, name: true, id: true },
    });
  }
  if (userType === 'SCHOOL_USER') {
    return prisma.schoolUser.findUnique({
      where: { id: userId },
      select: { email: true, name: true, id: true },
    });
  }
  if (userType === 'SUPER_ADMIN') {
    return prisma.superAdmin.findUnique({
      where: { id: userId },
      select: { email: true, name: true, id: true },
    });
  }
  return null;
}

/**
 * Get user notification preferences (for parents)
 */
export async function getUserPrefs(parentId) {
  return prisma.parentNotificationPref.findUnique({
    where: { parent_id: parentId },
  });
}

/**
 * Log notification to database
 */
export async function logNotification({
  userId,
  userType,
  type,
  channel,
  status,
  data,
  error = null,
}) {
  let parentId = null,
    schoolUserId = null,
    adminUserId = null;

  if (userType === 'PARENT_USER') parentId = userId;
  else if (userType === 'SCHOOL_USER') schoolUserId = userId;
  else if (userType === 'SUPER_ADMIN') adminUserId = userId;

  return prisma.notification
    .create({
      data: {
        parent_id: parentId,
        school_user_id: schoolUserId,
        admin_user_id: adminUserId,
        type,
        channel,
        status,
        payload: { data, error },
        sent_at: status === 'SENT' ? new Date() : null,
      },
    })
    .catch(() => {});
}
