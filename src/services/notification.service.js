// =============================================================================
// services/notification.service.js — RESQID
// Global notification base service.
// Low-level send functions + high-level notifyParent() with pref checking.
//
// FIXES:
//   - FCM/Firebase removed. Expo push tokens only.
//   - getPush imported from correct push.index.js (ExpoAdapter).
//   - sendToTopic removed (not supported by Expo).
//   - NOTIFICATION_TEMPLATES import removed (templates live in orchestrator).
//   - EMAIL_TEMPLATES / SMS_TEMPLATES imports removed (no hardcoded templates here).
//   - Dev mock uses ENV.NODE_ENV check (consistent with rest of app).
//   - getParentDeviceTokens queries expo_push_token field.
// =============================================================================

import { ENV } from '#config/env.js';
import { logger } from '#config/logger.js';
import { prisma } from '#config/prisma.js';
import { getEmail } from '#infrastructure/email/email.index.js';
import { getSms } from '#infrastructure/sms/sms.index.js';
import { getPush } from '#infrastructure/push/push.index.js';

const isDev = () => ENV.NODE_ENV === 'development';

// =============================================================================
// SMS CHANNEL
// =============================================================================

export const SmsChannel = {
  async send(phone, message, context = {}) {
    if (isDev()) {
      logger.info({ type: 'sms_dev_mock', phone, message, ...context }, '[DEV] SMS mock');
      return { success: true, mode: 'mock' };
    }
    try {
      const smsService = getSms();
      const result = await smsService.send(phone, message);
      logger.info({ phone, messageId: result.messageId }, 'SMS sent');
      return { success: true, mode: 'live', messageId: result.messageId };
    } catch (error) {
      logger.error({ error: error.message, phone, ...context }, 'SMS send failed');
      return { success: false, error: error.message };
    }
  },

  async sendTemplate(phone, templateName, templateData, context = {}) {
    if (isDev()) {
      logger.info(
        {
          type: 'sms_template_dev_mock',
          phone,
          template: templateName,
          data: templateData,
          ...context,
        },
        '[DEV] SMS template mock'
      );
      return { success: true, mode: 'mock' };
    }
    try {
      const smsService = getSms();
      const result = await smsService.sendTemplate(phone, templateName, templateData);
      logger.info(
        { phone, template: templateName, messageId: result.messageId },
        'Template SMS sent'
      );
      return { success: true, mode: 'live', messageId: result.messageId };
    } catch (error) {
      logger.error(
        { error: error.message, phone, template: templateName, ...context },
        'Template SMS failed'
      );
      return { success: false, error: error.message };
    }
  },
};

// =============================================================================
// EMAIL CHANNEL
// =============================================================================

export const EmailChannel = {
  async send(to, subject, html, text = null, context = {}) {
    if (isDev()) {
      logger.info({ type: 'email_dev_mock', to, subject, ...context }, '[DEV] Email mock');
      return { success: true, mode: 'mock' };
    }
    try {
      const emailService = getEmail();
      const result = await emailService.send({
        to,
        subject,
        html,
        text: text || html.replace(/<[^>]*>/g, ''),
      });
      logger.info({ to, subject, messageId: result.id }, 'Email sent');
      return { success: true, mode: 'live', messageId: result.id };
    } catch (error) {
      logger.error({ error: error.message, to, subject, ...context }, 'Email send failed');
      return { success: false, error: error.message };
    }
  },
};

// =============================================================================
// PUSH CHANNEL — Expo only, no FCM, no topics
// =============================================================================

export const PushChannel = {
  /**
   * Send to a single Expo push token.
   */
  async sendToDevice(deviceToken, title, body, data = {}, context = {}) {
    if (isDev()) {
      logger.info(
        { type: 'push_dev_mock', deviceToken, title, body, ...context },
        '[DEV] Push mock'
      );
      return { success: true, mode: 'mock' };
    }
    try {
      const pushService = getPush();
      const result = await pushService.sendToDevice(deviceToken, { title, body, data });
      logger.info({ deviceToken, title, successCount: result.successCount }, 'Push sent to device');
      return { success: true, mode: 'live', successCount: result.successCount };
    } catch (error) {
      logger.error(
        { error: error.message, deviceToken, title, ...context },
        'Push to device failed'
      );
      return { success: false, error: error.message };
    }
  },

  /**
   * Send to multiple Expo push tokens.
   */
  async sendToDevices(deviceTokens, title, body, data = {}, context = {}) {
    if (!deviceTokens?.length) {
      return { success: false, error: 'No device tokens provided' };
    }
    if (isDev()) {
      logger.info(
        { type: 'push_multicast_dev_mock', deviceCount: deviceTokens.length, title, ...context },
        '[DEV] Push multicast mock'
      );
      return { success: true, mode: 'mock', devices: deviceTokens.length };
    }
    try {
      const pushService = getPush();
      const result = await pushService.sendToDevices(deviceTokens, { title, body, data });
      logger.info(
        {
          deviceCount: deviceTokens.length,
          title,
          successCount: result.successCount,
          failureCount: result.failureCount,
        },
        'Push multicast sent'
      );
      return {
        success: result.successCount > 0,
        mode: 'live',
        successCount: result.successCount,
        failureCount: result.failureCount,
      };
    } catch (error) {
      logger.error(
        { error: error.message, deviceCount: deviceTokens.length, ...context },
        'Push multicast failed'
      );
      return { success: false, error: error.message };
    }
  },
};

// =============================================================================
// DB HELPERS
// =============================================================================

export async function getUserContact(userId, userType) {
  if (userType === 'PARENT_USER') {
    return prisma.parentUser.findUnique({
      where: { id: userId },
      select: { id: true, email: true, phone: true, name: true },
    });
  }
  if (userType === 'SCHOOL_USER') {
    return prisma.schoolUser.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, phone: true },
    });
  }
  if (userType === 'SUPER_ADMIN') {
    return prisma.superAdmin.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true },
    });
  }
  return null;
}

export async function getUserPrefs(parentId) {
  const prefs = await prisma.parentNotificationPref.findUnique({
    where: { parent_id: parentId },
  });
  return (
    prefs ?? {
      email_enabled: true,
      sms_enabled: true,
      push_enabled: true,
      emergency_only: false,
    }
  );
}

/**
 * Load active Expo push tokens for a parent.
 * Field: expo_push_token (not fcm_token).
 */
async function getParentExpoTokens(parentId) {
  const devices = await prisma.parentDevice.findMany({
    where: {
      parent_id: parentId,
      is_active: true,
      expo_push_token: { not: null },
    },
    select: { expo_push_token: true },
  });
  return devices.map(d => d.expo_push_token).filter(Boolean);
}

export async function logNotification({
  userId,
  userType,
  type,
  channel,
  status,
  data = {},
  error = null,
  metadata = {},
}) {
  let parentId = null;
  let schoolUserId = null;
  let adminUserId = null;

  if (userType === 'PARENT_USER') parentId = userId;
  else if (userType === 'SCHOOL_USER') schoolUserId = userId;
  else if (userType === 'SUPER_ADMIN') adminUserId = userId;

  // Redact OTP from logs
  const isOtpEvent = type?.includes('OTP') || type === 'USER_OTP_REQUESTED';
  const safePayload = isOtpEvent
    ? { ...data, otp: '[REDACTED]', message: '[REDACTED - OTP]' }
    : { data, error, metadata };

  try {
    return await prisma.notification.create({
      data: {
        parent_id: parentId,
        school_user_id: schoolUserId,
        admin_user_id: adminUserId,
        type,
        channel,
        status,
        payload: safePayload,
        sent_at: status === 'SENT' ? new Date() : null,
      },
    });
  } catch (err) {
    logger.error({ err, userId, userType, type }, 'Failed to log notification');
    return null;
  }
}

// =============================================================================
// notifyParent — high-level with preference checking
// Caller provides pre-rendered html/smsMessage. No template logic here.
// =============================================================================

export async function notifyParent({
  parentId,
  notificationType,
  title,
  message,
  emailSubject = null,
  emailHtml = null,
  smsMessage = null,
  pushData = {},
  isEmergency = false,
  metadata = {},
}) {
  const start = Date.now();
  try {
    const parent = await getUserContact(parentId, 'PARENT_USER');
    if (!parent) {
      logger.error({ parentId }, 'Parent not found');
      return { success: false, error: 'Parent not found' };
    }

    const prefs = await getUserPrefs(parentId);

    if (prefs.emergency_only && !isEmergency) {
      logger.info({ parentId, notificationType }, 'Notification skipped — emergency_only pref');
      return { success: true, skipped: true, reason: 'User preferences' };
    }

    const results = { email: null, sms: null, push: null };

    // Email
    if (prefs.email_enabled && parent.email && emailHtml) {
      results.email = await EmailChannel.send(
        parent.email,
        emailSubject || title,
        emailHtml,
        null,
        { notificationType, parentId, ...metadata }
      );
      await logNotification({
        userId: parentId,
        userType: 'PARENT_USER',
        type: notificationType,
        channel: 'EMAIL',
        status: results.email.success ? 'SENT' : 'FAILED',
        data: { title, to: parent.email },
        error: results.email.error,
        metadata,
      });
    }

    // SMS
    if (prefs.sms_enabled && parent.phone) {
      const smsText = smsMessage || message;
      results.sms = await SmsChannel.send(parent.phone, smsText, {
        notificationType,
        parentId,
        ...metadata,
      });
      await logNotification({
        userId: parentId,
        userType: 'PARENT_USER',
        type: notificationType,
        channel: 'SMS',
        status: results.sms.success ? 'SENT' : 'FAILED',
        data: { title, message: smsText, to: parent.phone },
        error: results.sms.error,
        metadata,
      });
    }

    // Push
    if (prefs.push_enabled) {
      const tokens = await getParentExpoTokens(parentId);
      if (tokens.length) {
        results.push = await PushChannel.sendToDevices(
          tokens,
          title,
          message,
          { type: notificationType, ...pushData },
          { notificationType, parentId, ...metadata }
        );
        await logNotification({
          userId: parentId,
          userType: 'PARENT_USER',
          type: notificationType,
          channel: 'PUSH',
          status: results.push.success ? 'SENT' : 'FAILED',
          data: { title, message, deviceCount: tokens.length },
          error: results.push.error,
          metadata,
        });
      }
    }

    const duration = Date.now() - start;
    logger.info({ parentId, notificationType, duration }, 'Parent notification completed');
    return { success: true, results, duration };
  } catch (error) {
    logger.error({ error, parentId, notificationType }, 'Parent notification failed');
    return { success: false, error: error.message };
  }
}

// =============================================================================
// CONVENIENCE EXPORTS
// =============================================================================

export async function sendSmsToParent(phone, message, context = {}) {
  return SmsChannel.send(phone, message, context);
}

export async function sendEmailToParent(to, subject, html, context = {}) {
  return EmailChannel.send(to, subject, html, null, context);
}

export async function sendPushToParent(parentId, title, body, data = {}, context = {}) {
  const prefs = await getUserPrefs(parentId);
  if (!prefs.push_enabled) {
    logger.info({ parentId }, 'Push disabled for parent');
    return { success: true, skipped: true, reason: 'Push disabled' };
  }
  const tokens = await getParentExpoTokens(parentId);
  if (!tokens.length) {
    return { success: false, error: 'No active Expo tokens' };
  }
  return PushChannel.sendToDevices(tokens, title, body, data, context);
}
