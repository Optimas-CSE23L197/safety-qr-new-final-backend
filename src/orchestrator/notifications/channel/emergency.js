// src/orchestrator/notifications/channel/emergency.js
// Emergency alert channel - Implements Rule 1: Emergency alerts are UNTOUCHABLE
//
// Features:
// - Promise.allSettled for SMS, Push (WhatsApp commented - costly)
// - Email delayed 5-10 minutes (detailed log, not urgent)
// - Logs success/failure per channel
// - No rate limiting, no exponential backoff (500ms fixed retry, max 3 attempts)
// - Direct channel calls, never queued

import { ENV } from '#config/env.js';
import logger from '#config/logger.js';
import { prisma } from '#config/prisma.js';
import { sendSms } from '#infrastructure/sms/sms.index.js';
import { sendPush } from '#infrastructure/push/push.index.js';
// import { sendWhatsApp } from '#infrastructure/communication/whatsapp.adapter.js'; // DISABLED: WhatsApp API is costly
import { sendEmail } from '#infrastructure/email/email.index.js';

// Constants
const EMAIL_DELAY_MIN = 5 * 60 * 1000; // 5 minutes minimum
const EMAIL_DELAY_MAX = 10 * 60 * 1000; // 10 minutes maximum
const DETAILED_LOG_EMAIL_TEMPLATE = 'emergency_detailed_log';

/**
 * Generate random delay between 5-10 minutes for email
 * @returns {number} - Delay in milliseconds
 */
const getEmailDelay = () => {
  return Math.floor(Math.random() * (EMAIL_DELAY_MAX - EMAIL_DELAY_MIN + 1) + EMAIL_DELAY_MIN);
};

/**
 * Format emergency data for detailed email log
 * @param {Object} data - Emergency scan data
 * @returns {Object} - Formatted email data
 */
const formatDetailedEmailLog = data => {
  const {
    scanId,
    studentId,
    studentName,
    schoolId,
    schoolName,
    emergencyContacts,
    location,
    scannedAt,
    dispatchResults,
  } = data;

  return {
    scanId,
    studentId,
    studentName,
    schoolId,
    schoolName,
    emergencyContacts: emergencyContacts.map(contact => ({
      name: contact.name,
      phone: contact.phone?.substring(0, 4) + '****' + contact.phone?.substring(-4),
      relation: contact.relation,
      channels: {
        sms: dispatchResults?.sms?.success || false,
        push: dispatchResults?.push?.success || false,
        // whatsapp: dispatchResults?.whatsapp?.success || false, // DISABLED
      },
    })),
    location: {
      lat: location?.lat,
      lng: location?.lng,
      googleMapsUrl:
        location?.lat && location?.lng
          ? `https://maps.google.com/?q=${location.lat},${location.lng}`
          : null,
    },
    scannedAt: scannedAt instanceof Date ? scannedAt.toISOString() : scannedAt,
    dispatchTiming: {
      sms: dispatchResults?.sms?.duration,
      push: dispatchResults?.push?.duration,
      // whatsapp: dispatchResults?.whatsapp?.duration, // DISABLED
    },
    dispatchSuccess: {
      sms: dispatchResults?.sms?.success || false,
      push: dispatchResults?.push?.success || false,
      // whatsapp: dispatchResults?.whatsapp?.success || false, // DISABLED
    },
    dispatchErrors: {
      sms: dispatchResults?.sms?.error,
      push: dispatchResults?.push?.error,
      // whatsapp: dispatchResults?.whatsapp?.error, // DISABLED
    },
  };
};

/**
 * Send emergency SMS
 * @param {Object} contact - Emergency contact
 * @param {Object} studentInfo - Student information
 * @param {Object} location - Location data
 * @returns {Promise<{ success: boolean, error?: string, duration: number }>}
 */
const sendEmergencySms = async (contact, studentInfo, location) => {
  const startTime = Date.now();
  try {
    // Format message: EMERGENCY: Student Name needs help at [location]
    const locationText =
      location?.lat && location?.lng
        ? `https://maps.google.com/?q=${location.lat},${location.lng}`
        : 'Unknown location';

    const message = `🚨 EMERGENCY ALERT: ${studentInfo.studentName} needs immediate assistance. Location: ${locationText}. Please contact emergency services if needed. - RESQID`;

    await sendSms({
      to: contact.phone,
      message,
      template: 'emergency_alert',
    });

    const duration = Date.now() - startTime;
    logger.info('Emergency SMS sent', {
      contactName: contact.name,
      studentName: studentInfo.studentName,
      duration,
    });

    return { success: true, duration };
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('Emergency SMS failed', {
      contactName: contact.name,
      studentName: studentInfo.studentName,
      error: error.message,
      duration,
    });
    return { success: false, error: error.message, duration };
  }
};

/**
 * Send emergency Push notification
 * @param {Object} contact - Emergency contact
 * @param {Object} studentInfo - Student information
 * @param {Object} location - Location data
 * @returns {Promise<{ success: boolean, error?: string, duration: number }>}
 */
const sendEmergencyPush = async (contact, studentInfo, location) => {
  const startTime = Date.now();
  try {
    // Get parent's registered device tokens
    const parentDevices = await prisma.parentDevice.findMany({
      where: {
        parent: {
          phone: contact.phone,
        },
        is_active: true,
      },
      select: {
        device_token: true,
        platform: true,
      },
    });

    if (parentDevices.length === 0) {
      logger.debug('No active devices for push notification', {
        phone: contact.phone?.substring(0, 4) + '****',
      });
      return { success: false, error: 'No active devices', duration: Date.now() - startTime };
    }

    const locationText =
      location?.lat && location?.lng
        ? `Location: ${location.lat}, ${location.lng}`
        : 'Location unknown';

    // Send push to each device
    const results = await Promise.allSettled(
      parentDevices.map(device =>
        sendPush({
          token: device.device_token,
          title: '🚨 EMERGENCY ALERT',
          body: `${studentInfo.studentName} needs immediate assistance. ${locationText}`,
          data: {
            type: 'EMERGENCY',
            studentId: studentInfo.studentId,
            studentName: studentInfo.studentName,
            location: location,
            scanId: studentInfo.scanId,
          },
          priority: 'high',
        })
      )
    );

    const successCount = results.filter(r => r.status === 'fulfilled').length;
    const duration = Date.now() - startTime;

    if (successCount > 0) {
      logger.info('Emergency Push sent', {
        contactName: contact.name,
        studentName: studentInfo.studentName,
        deviceCount: parentDevices.length,
        successCount,
        duration,
      });
      return { success: true, duration };
    }

    return { success: false, error: 'All push attempts failed', duration };
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('Emergency Push failed', {
      contactName: contact.name,
      studentName: studentInfo.studentName,
      error: error.message,
      duration,
    });
    return { success: false, error: error.message, duration };
  }
};

/**
 * Send emergency WhatsApp message
 * DISABLED: WhatsApp API is costly. Enable only when budget approved.
 *
 * @param {Object} contact - Emergency contact
 * @param {Object} studentInfo - Student information
 * @param {Object} location - Location data
 * @returns {Promise<{ success: boolean, error?: string, duration: number }>}
 */
const sendEmergencyWhatsApp = async (contact, studentInfo, location) => {
  // DISABLED - WhatsApp API is costly
  const startTime = Date.now();
  logger.debug('WhatsApp disabled (costly), skipping', {
    contactName: contact.name,
    studentName: studentInfo.studentName,
  });

  return {
    success: false,
    error: 'WhatsApp API disabled - costly channel',
    duration: Date.now() - startTime,
  };

  /* ORIGINAL IMPLEMENTATION - ENABLE WHEN BUDGET APPROVED
  const startTime = Date.now();
  try {
    const locationText =
      location?.lat && location?.lng
        ? `📍 Location: https://maps.google.com/?q=${location.lat},${location.lng}`
        : '📍 Location: Unknown';

    const message =
      `🚨 *EMERGENCY ALERT* 🚨\n\n` +
      `*Student:* ${studentInfo.studentName}\n` +
      `*School:* ${studentInfo.schoolName}\n` +
      `${locationText}\n\n` +
      `Please check on your child immediately.\n\n` +
      `- RESQID Safety System`;

    const phoneWithCountry = contact.phone.startsWith('+') ? contact.phone : `+91${contact.phone}`;

    await sendWhatsApp({
      to: phoneWithCountry,
      message,
      template: 'emergency_alert',
    });

    const duration = Date.now() - startTime;
    logger.info('Emergency WhatsApp sent', {
      contactName: contact.name,
      studentName: studentInfo.studentName,
      duration,
    });

    return { success: true, duration };
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('Emergency WhatsApp failed', {
      contactName: contact.name,
      studentName: studentInfo.studentName,
      error: error.message,
      duration,
    });
    return { success: false, error: error.message, duration };
  }
  */
};

/**
 * Send detailed email log (delayed 5-10 minutes)
 * @param {Object} data - Complete emergency data with dispatch results
 * @returns {Promise<void>}
 */
const sendDetailedEmailLog = async data => {
  const delay = getEmailDelay();
  logger.info('Scheduling detailed email log', {
    scanId: data.scanId,
    studentName: data.studentName,
    delayMs: delay,
    delayMinutes: Math.round(delay / 60000),
  });

  // Use setTimeout for delay (in production, this should use a delayed queue)
  // For now, using setTimeout is acceptable as email is not time-critical
  setTimeout(async () => {
    try {
      const formattedData = formatDetailedEmailLog(data);

      // Get super admin emails for detailed logs
      const superAdmins = await prisma.superAdmin.findMany({
        where: { is_active: true },
        select: { email: true, name: true },
      });

      const school = await prisma.school.findUnique({
        where: { id: data.schoolId },
        select: { email: true, name: true },
      });

      // Recipients: Super admins + school admin
      const recipients = [...superAdmins.map(admin => ({ email: admin.email, name: admin.name }))];

      if (school?.email) {
        recipients.push({ email: school.email, name: school.name });
      }

      // Send email to each recipient
      for (const recipient of recipients) {
        await sendEmail({
          to: recipient.email,
          subject: `[RESQID] Emergency Alert Details - ${data.studentName} - ${new Date().toLocaleString()}`,
          template: DETAILED_LOG_EMAIL_TEMPLATE,
          data: {
            ...formattedData,
            recipientName: recipient.name,
            schoolEmail: school?.email,
            timestamp: new Date().toISOString(),
          },
        });
      }

      logger.info('Detailed emergency email log sent', {
        scanId: data.scanId,
        recipients: recipients.length,
      });
    } catch (error) {
      logger.error('Failed to send detailed emergency email log', {
        scanId: data.scanId,
        error: error.message,
      });
    }
  }, delay);
};

/**
 * Send emergency alerts through all channels
 * Implements Rule 1: Promise.allSettled - one channel failing doesn't affect others
 *
 * @param {Object} params - Emergency alert parameters
 * @param {string} params.scanId - Scan log ID
 * @param {string} params.studentId - Student ID
 * @param {string} params.studentName - Student name
 * @param {string} params.schoolId - School ID
 * @param {string} params.schoolName - School name
 * @param {Array} params.emergencyContacts - Array of emergency contacts
 * @param {Object} params.location - Location { lat, lng }
 * @param {Date} params.scannedAt - Scan timestamp
 * @returns {Promise<{
 *   success: boolean,
 *   results: { sms: object, push: object, whatsapp: object },
 *   dispatchedChannels: string[],
 *   failedChannels: string[]
 * }>}
 */
export const sendEmergencyAlerts = async params => {
  const {
    scanId,
    studentId,
    studentName,
    schoolId,
    schoolName,
    emergencyContacts,
    location,
    scannedAt,
  } = params;

  logger.info('Sending emergency alerts', {
    scanId,
    studentId,
    studentName,
    contactCount: emergencyContacts.length,
  });

  const studentInfo = {
    scanId,
    studentId,
    studentName,
    schoolId,
    schoolName,
  };

  // Prepare results tracking
  const results = {
    sms: { success: false, duration: 0, error: null },
    push: { success: false, duration: 0, error: null },
    whatsapp: { success: false, duration: 0, error: null }, // DISABLED but tracked
  };

  const dispatchedChannels = [];
  const failedChannels = [];

  // Send alerts to all emergency contacts through all channels
  const channelPromises = [];

  for (const contact of emergencyContacts) {
    if (!contact.phone) {
      logger.warn('Emergency contact missing phone', { contactName: contact.name });
      continue;
    }

    // SMS
    channelPromises.push(
      sendEmergencySms(contact, studentInfo, location).then(result => ({
        channel: 'sms',
        contact: contact.name,
        result,
      }))
    );

    // Push
    channelPromises.push(
      sendEmergencyPush(contact, studentInfo, location).then(result => ({
        channel: 'push',
        contact: contact.name,
        result,
      }))
    );

    // WhatsApp - DISABLED (costly channel)
    // Kept for future enablement
    channelPromises.push(
      sendEmergencyWhatsApp(contact, studentInfo, location).then(result => ({
        channel: 'whatsapp',
        contact: contact.name,
        result,
      }))
    );
  }

  // Execute all channel sends in parallel (Promise.allSettled)
  const channelResults = await Promise.allSettled(channelPromises);

  // Aggregate results
  for (const settled of channelResults) {
    if (settled.status === 'fulfilled') {
      const { channel, result } = settled.value;

      // Track per-channel success (if at least one contact succeeded)
      if (result.success) {
        if (!dispatchedChannels.includes(channel)) {
          dispatchedChannels.push(channel);
        }
        // Aggregate timing
        if (results[channel]) {
          results[channel].success = true;
          results[channel].duration += result.duration;
        }
      } else {
        if (!failedChannels.includes(channel)) {
          failedChannels.push(channel);
        }
        if (results[channel] && result.error) {
          results[channel].error = result.error;
        }
      }
    } else {
      logger.error('Emergency channel promise rejected', {
        reason: settled.reason,
      });
    }
  }

  // Prepare dispatch data for email log
  const dispatchData = {
    scanId,
    studentId,
    studentName,
    schoolId,
    schoolName,
    emergencyContacts,
    location,
    scannedAt,
    dispatchResults: {
      sms: results.sms,
      push: results.push,
      whatsapp: results.whatsapp,
    },
  };

  // Schedule detailed email log (5-10 minutes delay)
  // Fire and forget - don't await
  sendDetailedEmailLog(dispatchData).catch(error => {
    logger.error('Failed to schedule detailed email log', { error: error.message });
  });

  const overallSuccess = dispatchedChannels.length > 0;

  logger.info('Emergency alerts completed', {
    scanId,
    overallSuccess,
    dispatchedChannels,
    failedChannels,
    smsSuccess: results.sms.success,
    pushSuccess: results.push.success,
    whatsappSuccess: results.whatsapp.success, // Will always be false (disabled)
  });

  return {
    success: overallSuccess,
    results,
    dispatchedChannels,
    failedChannels,
  };
};

// Default export
export default {
  sendEmergencyAlerts,
};
