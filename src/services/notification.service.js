// =============================================================================
// services/global/notification.service.js — RESQID
// GLOBAL NOTIFICATION BASE SERVICE
// Provides low-level send functions for SMS, Email, Push
// Uses infrastructure layer for actual delivery
// =============================================================================

import { ENV } from '#config/env.js';
import { logger } from '#config/logger.js';
import { prisma } from '#config/prisma.js';

// Import infrastructure layer
import { getEmail, EMAIL_TEMPLATES } from '#infrastructure/email/email.index.js';
import { getSms, SMS_TEMPLATES } from '#infrastructure/sms/sms.index.js';
import { getPush, NOTIFICATION_TEMPLATES } from '#infrastructure/push/push.index.js';

// =============================================================================
// NOTIFICATION CHANNELS
// =============================================================================

/**
 * SMS Channel - Uses your MSG91 adapter
 */
export const SmsChannel = {
  /**
   * Send SMS using infrastructure layer
   */
  async send(phone, message, context = {}) {
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
      const smsService = getSms();
      const result = await smsService.send(phone, message);

      logger.info({ phone, messageId: result.messageId }, 'SMS sent successfully');
      return { success: true, mode: 'live', messageId: result.messageId };
    } catch (error) {
      logger.error({ error: error.message, phone, ...context }, 'SMS send failed');
      return { success: false, error: error.message };
    }
  },

  /**
   * Send templated SMS
   */
  async sendTemplate(phone, templateName, templateData, context = {}) {
    const isDev = ENV.IS_DEV;

    if (isDev) {
      logger.info(
        {
          type: 'sms_template_dev_mock',
          phone,
          template: templateName,
          data: templateData,
          ...context,
        },
        `[DEV] SMS template "${templateName}" to ${phone}`
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

/**
 * Email Channel - Uses your Resend adapter
 */
export const EmailChannel = {
  /**
   * Send email using infrastructure layer
   */
  async send(to, subject, html, text = null, context = {}) {
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
      const emailService = getEmail();
      const result = await emailService.send({
        to,
        subject,
        html,
        text: text || html.replace(/<[^>]*>/g, ''), // Strip HTML for text version
      });

      logger.info({ to, subject, messageId: result.id }, 'Email sent successfully');
      return { success: true, mode: 'live', messageId: result.id };
    } catch (error) {
      logger.error({ error: error.message, to, subject, ...context }, 'Email send failed');
      return { success: false, error: error.message };
    }
  },

  /**
   * Send templated email using infrastructure templates
   */
  async sendTemplate(to, templateName, templateData, subjectOverride = null, context = {}) {
    const isDev = ENV.IS_DEV;
    const template = EMAIL_TEMPLATES[templateName];

    if (!template) {
      logger.error({ templateName }, 'Email template not found');
      return { success: false, error: `Template "${templateName}" not found` };
    }

    // Replace variables in subject if needed
    let subject = subjectOverride || templateName.replace(/_/g, ' ');
    if (templateData.subject) {
      subject = templateData.subject;
    }

    if (isDev) {
      logger.info(
        {
          type: 'email_template_dev_mock',
          to,
          template: templateName,
          data: templateData,
          ...context,
        },
        `[DEV] Email template "${templateName}" to ${to}`
      );
      return { success: true, mode: 'mock' };
    }

    try {
      const emailService = getEmail();
      const result = await emailService.sendTemplate(templateName, templateData, to, subject);

      logger.info({ to, template: templateName, messageId: result.id }, 'Template email sent');
      return { success: true, mode: 'live', messageId: result.id };
    } catch (error) {
      logger.error(
        { error: error.message, to, template: templateName, ...context },
        'Template email failed'
      );
      return { success: false, error: error.message };
    }
  },
};

/**
 * Push Notification Channel - Uses your Firebase adapter
 */
export const PushChannel = {
  /**
   * Send push notification using infrastructure layer
   */
  async sendToDevice(deviceToken, title, body, data = {}, context = {}) {
    const isDev = ENV.IS_DEV;

    if (isDev) {
      logger.info(
        {
          type: 'push_dev_mock',
          deviceToken,
          title,
          body,
          data,
          ...context,
        },
        `[DEV] Push to device: ${title}`
      );
      return { success: true, mode: 'mock' };
    }

    try {
      const pushService = getPush();
      const result = await pushService.sendToDevice(deviceToken, { title, body, data });

      logger.info({ deviceToken, title, messageId: result.messageId }, 'Push sent to device');
      return { success: true, mode: 'live', messageId: result.messageId };
    } catch (error) {
      logger.error(
        { error: error.message, deviceToken, title, ...context },
        'Push to device failed'
      );
      return { success: false, error: error.message };
    }
  },

  /**
   * Send push to multiple devices
   */
  async sendToDevices(deviceTokens, title, body, data = {}, context = {}) {
    if (!deviceTokens.length) {
      return { success: false, error: 'No device tokens provided' };
    }

    const isDev = ENV.IS_DEV;

    if (isDev) {
      logger.info(
        {
          type: 'push_multicast_dev_mock',
          deviceCount: deviceTokens.length,
          title,
          body,
          ...context,
        },
        `[DEV] Push to ${deviceTokens.length} devices: ${title}`
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
        success: true,
        mode: 'live',
        successCount: result.successCount,
        failureCount: result.failureCount,
        responses: result.responses,
      };
    } catch (error) {
      logger.error(
        { error: error.message, deviceCount: deviceTokens.length, title, ...context },
        'Push multicast failed'
      );
      return { success: false, error: error.message };
    }
  },

  /**
   * Send push to a topic
   */
  async sendToTopic(topic, title, body, data = {}, context = {}) {
    const isDev = ENV.IS_DEV;

    if (isDev) {
      logger.info(
        {
          type: 'push_topic_dev_mock',
          topic,
          title,
          body,
          ...context,
        },
        `[DEV] Push to topic "${topic}": ${title}`
      );
      return { success: true, mode: 'mock' };
    }

    try {
      const pushService = getPush();
      const result = await pushService.sendToTopic(topic, { title, body, data });

      logger.info({ topic, title, messageId: result.messageId }, 'Push sent to topic');
      return { success: true, mode: 'live', messageId: result.messageId };
    } catch (error) {
      logger.error({ error: error.message, topic, title, ...context }, 'Push to topic failed');
      return { success: false, error: error.message };
    }
  },
};

// =============================================================================
// HIGH-LEVEL NOTIFICATION FUNCTIONS (with user preferences & database logging)
// =============================================================================

/**
 * Get user contact info by user type
 */
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

/**
 * Get user notification preferences (with defaults)
 */
export async function getUserPrefs(parentId) {
  const prefs = await prisma.parentNotificationPref.findUnique({
    where: { parent_id: parentId },
  });

  // Return defaults if no preferences found
  return (
    prefs || {
      email_enabled: true,
      sms_enabled: true,
      push_enabled: true,
      emergency_only: false,
    }
  );
}

/**
 * Check if user wants to receive this type of notification
 */
async function shouldSendNotification(prefs, notificationType, isEmergency = false) {
  if (!prefs) return true;

  // If emergency only mode is on, only send emergency notifications
  if (prefs.emergency_only && !isEmergency) {
    return false;
  }

  return true;
}

/**
 * Get active device tokens for a parent
 */
async function getParentDeviceTokens(parentId) {
  const devices = await prisma.parentDevice.findMany({
    where: {
      parent_id: parentId,
      is_active: true,
      device_token: { not: null },
    },
    select: { device_token: true, platform: true },
  });

  return devices.map(d => d.device_token).filter(Boolean);
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

  try {
    return await prisma.notification.create({
      data: {
        parent_id: parentId,
        school_user_id: schoolUserId,
        admin_user_id: adminUserId,
        type,
        channel,
        status,
        payload: { data, error, metadata },
        sent_at: status === 'SENT' ? new Date() : null,
      },
    });
  } catch (err) {
    // Don't let logging failure break the notification flow
    logger.error({ err, userId, userType, type }, 'Failed to log notification');
    return null;
  }
}

// =============================================================================
// CONVENIENCE FUNCTIONS
// =============================================================================

/**
 * Send notification to a parent with preference checking
 */
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
  const startTime = Date.now();

  try {
    // Get parent details
    const parent = await getUserContact(parentId, 'PARENT_USER');
    if (!parent) {
      logger.error({ parentId }, 'Parent not found');
      return { success: false, error: 'Parent not found' };
    }

    // Get preferences
    const prefs = await getUserPrefs(parentId);

    // Check if we should send
    if (!(await shouldSendNotification(prefs, notificationType, isEmergency))) {
      logger.info({ parentId, notificationType, prefs }, 'Notification skipped due to preferences');
      return { success: true, skipped: true, reason: 'User preferences' };
    }

    const results = {
      email: null,
      sms: null,
      push: null,
    };

    // Send email if enabled
    if (prefs.email_enabled && parent.email) {
      if (emailHtml) {
        results.email = await EmailChannel.send(
          parent.email,
          emailSubject || title,
          emailHtml,
          null,
          { notificationType, parentId, ...metadata }
        );
      } else {
        // Use default email template
        results.email = await EmailChannel.sendTemplate(
          parent.email,
          'EMERGENCY_ALERT',
          {
            studentName: metadata.studentName || 'your child',
            timestamp: new Date().toISOString(),
            location: metadata.location || 'Unknown',
            message: message,
            emergencyUrl: metadata.emergencyUrl || '#',
          },
          emailSubject || title,
          { notificationType, parentId, ...metadata }
        );
      }

      await logNotification({
        userId: parentId,
        userType: 'PARENT_USER',
        type: notificationType,
        channel: 'EMAIL',
        status: results.email.success ? 'SENT' : 'FAILED',
        data: { title, message, to: parent.email },
        error: results.email.error,
        metadata,
      });
    }

    // Send SMS if enabled
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

    // Send push if enabled
    if (prefs.push_enabled) {
      const deviceTokens = await getParentDeviceTokens(parentId);
      if (deviceTokens.length) {
        results.push = await PushChannel.sendToDevices(
          deviceTokens,
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
          data: { title, message, deviceCount: deviceTokens.length },
          error: results.push.error,
          metadata,
        });
      }
    }

    const duration = Date.now() - startTime;
    logger.info({ parentId, notificationType, results, duration }, 'Parent notification completed');

    return {
      success: true,
      results,
      duration,
    };
  } catch (error) {
    logger.error({ error, parentId, notificationType }, 'Parent notification failed');
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Simple SMS send (no preference checking)
 */
export async function sendSmsNotification(phone, message, context = {}) {
  return SmsChannel.send(phone, message, context);
}

/**
 * Simple email send (no preference checking)
 */
export async function sendEmailNotification(to, subject, html, context = {}) {
  return EmailChannel.send(to, subject, html, null, context);
}

/**
 * Simple push send to parent (with preference checking)
 */
export async function sendPushNotification(parentId, title, body, data = {}, context = {}) {
  const prefs = await getUserPrefs(parentId);
  if (!prefs.push_enabled) {
    logger.info({ parentId }, 'Push disabled for parent');
    return { success: true, skipped: true, reason: 'Push disabled' };
  }

  const deviceTokens = await getParentDeviceTokens(parentId);
  if (!deviceTokens.length) {
    return { success: false, error: 'No active devices' };
  }

  return PushChannel.sendToDevices(deviceTokens, title, body, data, context);
}
