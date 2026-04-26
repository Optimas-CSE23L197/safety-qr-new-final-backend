import { logger } from '#config/logger.js';
import { prisma } from '#config/prisma.js';
import { getSms } from '#infrastructure/sms/sms.index.js';
import { getPush } from '#infrastructure/push/push.index.js';
import { getEmail } from '#infrastructure/email/email.index.js';
import { backgroundJobsQueue } from '../../queues/queue.config.js';

const EMERGENCY_SMS_ENABLED = process.env.EMERGENCY_SMS_ENABLED === 'true';

// ── SMS ───────────────────────────────────────────────────────────────────────

const sendEmergencySms = async (contact, studentInfo, location) => {
  const start = Date.now();

  if (!EMERGENCY_SMS_ENABLED) {
    logger.warn(
      { contactName: contact.name },
      '[emergency] SMS skipped — EMERGENCY_SMS_ENABLED=false'
    );
    return { success: false, error: 'SMS disabled via env', duration: Date.now() - start };
  }

  try {
    const sms = getSms();
    const locationText =
      location?.lat && location?.lng ? `${location.lat}, ${location.lng}` : 'Unknown';

    const body = `EMERGENCY: ${studentInfo.studentName} needs help at ${locationText}. Check ResQID app immediately. -RESQID`;

    const result = await sms.send(contact.phone, body);

    const duration = Date.now() - start;
    if (result?.success || result?.id) {
      logger.info({ contactName: contact.name, duration }, '[emergency] SMS sent');
      return { success: true, duration };
    }

    return { success: false, error: result?.error ?? 'SMS failed', duration };
  } catch (error) {
    logger.error({ contactName: contact.name, error: error.message }, '[emergency] SMS failed');
    return { success: false, error: error.message, duration: Date.now() - start };
  }
};

// ── Push ──────────────────────────────────────────────────────────────────────

const sendEmergencyPush = async (contact, studentInfo, location) => {
  const start = Date.now();
  try {
    const parentDevices = await prisma.parentDevice.findMany({
      where: { parent_id: contact.parentId, is_active: true },
      select: { expo_push_token: true },
    });

    const tokens = parentDevices.map(d => d.expo_push_token).filter(Boolean);

    if (tokens.length === 0) {
      logger.debug({ parentId: contact.parentId }, '[emergency] No active Expo tokens for push');
      return { success: false, error: 'No active Expo tokens', duration: Date.now() - start };
    }

    const locationText =
      location?.lat && location?.lng ? `${location.lat}, ${location.lng}` : 'Unknown';

    const notification = {
      title: '🚨 Emergency Alert',
      body: `${studentInfo.studentName} needs immediate assistance. Location: ${locationText}`,
      data: {
        type: 'EMERGENCY',
        studentId: studentInfo.studentId,
        studentName: studentInfo.studentName,
        location,
        scanId: studentInfo.scanId,
      },
    };

    const push = getPush();
    const result = await push.sendToDevices(tokens, notification);

    const duration = Date.now() - start;

    if (result?.success || (result?.successCount ?? 0) > 0) {
      logger.info(
        { contactName: contact.name, tokenCount: tokens.length, duration },
        '[emergency] Push sent'
      );
      return { success: true, duration };
    }

    return { success: false, error: result?.error ?? 'Push failed', duration };
  } catch (error) {
    logger.error({ contactName: contact.name, error: error.message }, '[emergency] Push failed');
    return { success: false, error: error.message, duration: Date.now() - start };
  }
};

// ── Delayed email log via BullMQ ──────────────────────────────────────────────

const scheduleEmergencyEmailLog = async data => {
  try {
    await backgroundJobsQueue.add(
      'EMERGENCY_EMAIL_LOG',
      { type: 'EMERGENCY_EMAIL_LOG', payload: data },
      {
        delay: 5 * 60 * 1000,
        attempts: 3,
        backoff: { type: 'exponential', delay: 60000 },
        jobId: `emergency-email-log-${data.scanId}`,
      }
    );
    logger.info({ scanId: data.scanId }, '[emergency] Email log job scheduled (5 min delay)');
  } catch (err) {
    logger.error(
      { scanId: data.scanId, err: err.message },
      '[emergency] Failed to schedule email log job'
    );
  }
};

export const sendEmergencyEmailLog = async data => {
  try {
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

    const [superAdmins, school] = await Promise.all([
      prisma.superAdmin.findMany({
        where: { is_active: true },
        select: { email: true, name: true },
      }),
      prisma.school.findUnique({
        where: { id: schoolId },
        select: { email: true, name: true },
      }),
    ]);

    const recipients = superAdmins.map(a => a.email).filter(Boolean);
    if (school?.email) recipients.push(school.email);

    if (!recipients.length) {
      logger.warn({ scanId }, '[emergency] No recipients for email log');
      return;
    }

    logger.warn(
      { scanId, recipientCount: recipients.length },
      '[emergency] EmergencyLogEmail component not yet wired — email log skipped'
    );

    logger.info({ scanId, recipientCount: recipients.length }, '[emergency] Email log processed');
  } catch (err) {
    logger.error({ scanId: data?.scanId, err: err.message }, '[emergency] Email log send failed');
    throw err;
  }
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
    { scanId, studentId, studentName, contactCount: emergencyContacts?.length ?? 0 },
    '[emergency] Sending emergency alerts'
  );

  const studentInfo = { scanId, studentId, studentName, schoolId, schoolName, scannedAt };
  const results = {
    sms: { success: false, duration: 0, error: null },
    push: { success: false, duration: 0, error: null },
  };

  const dispatchedChannels = [];
  const failedChannels = [];
  const channelPromises = [];

  for (const contact of emergencyContacts ?? []) {
    if (!contact.phone) {
      logger.warn({ contactName: contact.name }, '[emergency] Contact missing phone — skipping');
      continue;
    }

    channelPromises.push(
      sendEmergencyPush(contact, studentInfo, location).then(result => ({
        channel: 'push',
        result,
      }))
    );
    channelPromises.push(
      sendEmergencySms(contact, studentInfo, location).then(result => ({ channel: 'sms', result }))
    );
  }

  const settled = await Promise.allSettled(channelPromises);

  for (const s of settled) {
    if (s.status === 'fulfilled') {
      const { channel, result } = s.value;
      if (result.success) {
        if (!dispatchedChannels.includes(channel)) dispatchedChannels.push(channel);
        if (channel === 'sms') results.sms.success = true;
        if (channel === 'push') results.push.success = true;
        results[channel].duration += result.duration;
      } else {
        if (!failedChannels.includes(channel)) failedChannels.push(channel);
        results[channel].error = result.error;
      }
    } else {
      logger.error({ reason: s.reason }, '[emergency] Channel promise rejected');
    }
  }

  try {
    scheduleEmergencyEmailLog({
      scanId,
      studentId,
      studentName,
      schoolId,
      schoolName,
      emergencyContacts,
      location,
      scannedAt,
      dispatchResults: results,
    }).catch(err => logger.error({ err: err.message }, '[emergency] Failed to schedule email log'));
  } catch (err) {
    logger.error({ err: err.message }, '[emergency] scheduleEmergencyEmailLog threw synchronously');
  }

  const overallSuccess = dispatchedChannels.length > 0;

  logger.info(
    { scanId, overallSuccess, dispatchedChannels, failedChannels },
    '[emergency] Alerts completed'
  );

  return { success: overallSuccess, results, dispatchedChannels, failedChannels };
};

export default { sendEmergencyAlerts, sendEmergencyEmailLog };
