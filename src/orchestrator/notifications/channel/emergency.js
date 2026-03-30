// src/orchestrator/notifications/channel/emergency.js
// Emergency alert channel — Rule 1: Emergency alerts are UNTOUCHABLE.
//
// Direct channel calls — never queued, never rate-limited.
// Fixed: imports now use getSms() / getPush() / getEmail() singletons,
//        not the non-existent sendSms / sendPush / sendEmail named exports.

import logger from '#config/logger.js';
import { prisma } from '#config/prisma.js';
import { getSms } from '#infrastructure/sms/sms.index.js';
import { getPush } from '#infrastructure/push/push.index.js';
import { getEmail } from '#infrastructure/email/email.index.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const EMAIL_DELAY_MIN = 5 * 60 * 1000;
const EMAIL_DELAY_MAX = 10 * 60 * 1000;
const getEmailDelay = () =>
  Math.floor(Math.random() * (EMAIL_DELAY_MAX - EMAIL_DELAY_MIN + 1) + EMAIL_DELAY_MIN);

// ── Helpers ───────────────────────────────────────────────────────────────────

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
      phone: contact.phone?.substring(0, 4) + '****' + contact.phone?.slice(-4),
      relation: contact.relation,
      channels: {
        sms: dispatchResults?.sms?.success || false,
        push: dispatchResults?.push?.success || false,
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
    },
    dispatchSuccess: {
      sms: dispatchResults?.sms?.success || false,
      push: dispatchResults?.push?.success || false,
    },
    dispatchErrors: {
      sms: dispatchResults?.sms?.error,
      push: dispatchResults?.push?.error,
    },
  };
};

// ── Channel senders ───────────────────────────────────────────────────────────

const sendEmergencySms = async (contact, studentInfo, location) => {
  const startTime = Date.now();
  try {
    const locationText =
      location?.lat && location?.lng
        ? `https://maps.google.com/?q=${location.lat},${location.lng}`
        : 'Unknown location';

    const message = `🚨 EMERGENCY ALERT: ${studentInfo.studentName} needs immediate assistance. Location: ${locationText}. Please contact emergency services if needed. - RESQID`;

    // FIX: getSms() returns the MSG91Adapter instance; call .send() on it
    const sms = getSms();
    await sms.send(contact.phone, message);

    const duration = Date.now() - startTime;
    logger.info(
      { contactName: contact.name, studentName: studentInfo.studentName, duration },
      'Emergency SMS sent'
    );
    return { success: true, duration };
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error(
      {
        contactName: contact.name,
        studentName: studentInfo.studentName,
        error: error.message,
        duration,
      },
      'Emergency SMS failed'
    );
    return { success: false, error: error.message, duration };
  }
};

const sendEmergencyPush = async (contact, studentInfo, location) => {
  const startTime = Date.now();
  try {
    const parentDevices = await prisma.parentDevice.findMany({
      where: { parent: { phone: contact.phone }, is_active: true },
      select: { device_token: true, platform: true },
    });

    if (parentDevices.length === 0) {
      logger.debug(
        { phone: contact.phone?.substring(0, 4) + '****' },
        'No active devices for push notification'
      );
      return { success: false, error: 'No active devices', duration: Date.now() - startTime };
    }

    const locationText =
      location?.lat && location?.lng
        ? `Location: ${location.lat}, ${location.lng}`
        : 'Location unknown';

    const notification = {
      title: '🚨 EMERGENCY ALERT',
      body: `${studentInfo.studentName} needs immediate assistance. ${locationText}`,
      data: {
        type: 'EMERGENCY',
        studentId: studentInfo.studentId,
        studentName: studentInfo.studentName,
        location,
        scanId: studentInfo.scanId,
      },
    };

    // FIX: getPush() returns the FirebaseAdapter instance
    const push = getPush();
    const tokens = parentDevices.map(d => d.device_token);

    const results = await Promise.allSettled(
      tokens.length === 1
        ? [push.sendToDevice(tokens[0], notification)]
        : [push.sendToDevices(tokens, notification)]
    );

    const successCount = results.filter(r => r.status === 'fulfilled').length;
    const duration = Date.now() - startTime;

    if (successCount > 0) {
      logger.info(
        {
          contactName: contact.name,
          studentName: studentInfo.studentName,
          deviceCount: tokens.length,
          successCount,
          duration,
        },
        'Emergency Push sent'
      );
      return { success: true, duration };
    }

    return { success: false, error: 'All push attempts failed', duration };
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error(
      {
        contactName: contact.name,
        studentName: studentInfo.studentName,
        error: error.message,
        duration,
      },
      'Emergency Push failed'
    );
    return { success: false, error: error.message, duration };
  }
};

// ── Delayed email log ─────────────────────────────────────────────────────────

const sendDetailedEmailLog = async data => {
  const delay = getEmailDelay();
  logger.info({ scanId: data.scanId, delayMs: delay }, 'Scheduling detailed email log');

  setTimeout(async () => {
    try {
      const formattedData = formatDetailedEmailLog(data);

      const [superAdmins, school] = await Promise.all([
        prisma.superAdmin.findMany({
          where: { is_active: true },
          select: { email: true, name: true },
        }),
        prisma.school.findUnique({
          where: { id: data.schoolId },
          select: { email: true, name: true },
        }),
      ]);

      const recipients = superAdmins.map(a => ({ email: a.email, name: a.name }));
      if (school?.email) recipients.push({ email: school.email, name: school.name });

      // FIX: getEmail() returns the ResendAdapter instance; call .send() on it
      const email = getEmail();

      await Promise.allSettled(
        recipients.map(recipient =>
          email.send({
            to: recipient.email,
            subject: `[RESQID] Emergency Alert Details - ${data.studentName} - ${new Date().toLocaleString()}`,
            html: `<pre>${JSON.stringify(formattedData, null, 2)}</pre>`, // replace with real template
          })
        )
      );

      logger.info(
        { scanId: data.scanId, recipients: recipients.length },
        'Detailed emergency email log sent'
      );
    } catch (error) {
      logger.error(
        { scanId: data.scanId, error: error.message },
        'Failed to send detailed emergency email log'
      );
    }
  }, delay);
};

// ── Main export ───────────────────────────────────────────────────────────────

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

  logger.info(
    { scanId, studentId, studentName, contactCount: emergencyContacts.length },
    'Sending emergency alerts'
  );

  const studentInfo = { scanId, studentId, studentName, schoolId, schoolName };

  const results = {
    sms: { success: false, duration: 0, error: null },
    push: { success: false, duration: 0, error: null },
  };

  const dispatchedChannels = [];
  const failedChannels = [];

  const channelPromises = [];

  for (const contact of emergencyContacts) {
    if (!contact.phone) {
      logger.warn({ contactName: contact.name }, 'Emergency contact missing phone');
      continue;
    }

    channelPromises.push(
      sendEmergencySms(contact, studentInfo, location).then(result => ({
        channel: 'sms',
        contact: contact.name,
        result,
      }))
    );
    channelPromises.push(
      sendEmergencyPush(contact, studentInfo, location).then(result => ({
        channel: 'push',
        contact: contact.name,
        result,
      }))
    );
    // WhatsApp: DISABLED (costly). Re-enable here only when MSG91 WhatsApp is configured.
  }

  const channelResults = await Promise.allSettled(channelPromises);

  for (const settled of channelResults) {
    if (settled.status === 'fulfilled') {
      const { channel, result } = settled.value;
      if (result.success) {
        if (!dispatchedChannels.includes(channel)) dispatchedChannels.push(channel);
        results[channel].success = true;
        results[channel].duration += result.duration;
      } else {
        if (!failedChannels.includes(channel)) failedChannels.push(channel);
        if (result.error) results[channel].error = result.error;
      }
    } else {
      logger.error({ reason: settled.reason }, 'Emergency channel promise rejected');
    }
  }

  // Fire-and-forget delayed email log
  sendDetailedEmailLog({
    scanId,
    studentId,
    studentName,
    schoolId,
    schoolName,
    emergencyContacts,
    location,
    scannedAt,
    dispatchResults: results,
  }).catch(error =>
    logger.error({ error: error.message }, 'Failed to schedule detailed email log')
  );

  const overallSuccess = dispatchedChannels.length > 0;

  logger.info(
    { scanId, overallSuccess, dispatchedChannels, failedChannels },
    'Emergency alerts completed'
  );

  return { success: overallSuccess, results, dispatchedChannels, failedChannels };
};

export default { sendEmergencyAlerts };
