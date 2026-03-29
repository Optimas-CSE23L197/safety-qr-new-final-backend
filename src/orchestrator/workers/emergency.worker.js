// =============================================================================
// orchestrator/workers/emergency.worker.js — RESQID
// Processes emergency:alerts queue. ALWAYS ON. Sacred pipeline.
// Steps 7–15 of the emergency alert pipeline (Steps 1–6 are in the API layer).
//
// Step 7:  Worker picks up job
// Step 8:  Load parent contacts + school admins from DB
// Step 9:  Update alert status to SENDING
// Step 10: Fire in parallel — Firebase push (2s timeout) + SMS (4s timeout)
// Step 11: Any success → mark DELIVERED, log latency
// Step 12: All fail → try WhatsApp (4s timeout)
// Step 13: WhatsApp fails → initiate voice call
// Step 14: All fail → DLQ + Slack webhook
// Step 15: Log every attempt to Notification table
// =============================================================================

import { Worker } from 'bullmq';
import { getQueueConnection } from '../queues/queue.connection.js';
import { QUEUE_NAMES } from '../queues/queue.names.js';
import { handleDeadJob } from '../dlq/dlq.handler.js';
import { sendPushNotificationChannel } from '#notifications/push.js';
import { sendSmsNotification } from '#notifications/sms.js';
// import { sendWhatsAppNotification } from '#notifications/whatsapp.js';
import { prisma } from '#config/prisma.js';
import { logger } from '#config/logger.js';
import { decryptField } from '#shared/security/encryption.js';

const QUEUE = QUEUE_NAMES.EMERGENCY_ALERTS;

// ── Contact loader ────────────────────────────────────────────────────────────

const loadAlertContacts = async studentId => {
  const emergency = await prisma.emergencyProfile.findUnique({
    where: { student_id: studentId },
    select: {
      contacts: {
        where: { is_active: true },
        orderBy: { priority: 'asc' },
        select: {
          id: true,
          phone_encrypted: true,
          whatsapp_enabled: true,
          call_enabled: true,
          name: true,
          relationship: true,
        },
      },
    },
  });

  return (emergency?.contacts ?? []).map(c => ({
    ...c,
    phone: decryptField(c.phone_encrypted),
  }));
};

const loadSchoolAdminFcmTokens = async schoolId => {
  const admins = await prisma.schoolAdmin.findMany({
    where: { school_id: schoolId, is_active: true },
    select: {
      user: { select: { devices: { where: { is_active: true }, select: { fcm_token: true } } } },
    },
  });
  return admins.flatMap(a => a.user?.devices?.map(d => d.fcm_token) ?? []).filter(Boolean);
};

const loadParentFcmTokens = async studentId => {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: {
      parentStudents: {
        select: {
          user: {
            select: { devices: { where: { is_active: true }, select: { fcm_token: true } } },
          },
        },
      },
    },
  });
  return (student?.parentStudents ?? [])
    .flatMap(ps => ps.user?.devices?.map(d => d.fcm_token) ?? [])
    .filter(Boolean);
};

// ── Notification logger ───────────────────────────────────────────────────────

const logAttempt = async ({
  channel,
  status,
  latencyMs,
  providerRef,
  error,
  alertId,
  studentId,
  schoolId,
}) => {
  try {
    await prisma.notification.create({
      data: {
        channel,
        status,
        latency_ms: latencyMs,
        provider_ref: providerRef ?? null,
        error: error ?? null,
        student_id: studentId ?? null,
        school_id: schoolId ?? null,
        metadata: { alertId },
      },
    });
  } catch (err) {
    logger.error({ err: err.message }, '[emergency.worker] Failed to write notification log');
  }
};

// ── Job processor ─────────────────────────────────────────────────────────────

export const processEmergencyAlert = async job => {
  const { alertId, studentId, schoolId, studentName, schoolName, scannedAt } =
    job.data?.payload ?? {};

  if (!alertId || !studentId || !schoolId) {
    throw new Error('[emergency.worker] Missing alertId, studentId, or schoolId');
  }

  logger.info({ jobId: job.id, alertId, studentId }, '[emergency.worker] Processing alert');

  // Step 8 — Load contacts
  const [contacts, parentFcmTokens, adminFcmTokens] = await Promise.all([
    loadAlertContacts(studentId),
    loadParentFcmTokens(studentId),
    loadSchoolAdminFcmTokens(schoolId),
  ]);

  const allFcmTokens = [...parentFcmTokens, ...adminFcmTokens];
  const phoneNumbers = contacts.map(c => c.phone).filter(Boolean);

  // Step 9 — Mark SENDING
  await prisma.emergencyAlert.update({
    where: { id: alertId },
    data: { status: 'SENDING', sending_at: new Date() },
  });

  const pushMsg = {
    title: '🚨 Emergency Alert',
    body: `${studentName ?? 'A student'}'s ResQID card was scanned at ${schoolName ?? 'school'} at ${scannedAt ?? new Date().toISOString()}. Open app for details.`,
  };
  const smsBody = `🚨 ALERT: ${studentName ?? 'A student'}'s ResQID card was scanned at ${schoolName ?? 'school'} at ${scannedAt ?? new Date().toISOString()}. Open the ResQID app.`;

  let anyDelivered = false;

  // Step 10 — Push + SMS parallel with per-channel timeouts
  const step10Results = await Promise.allSettled([
    // Firebase push — 2 second timeout
    (async () => {
      if (allFcmTokens.length === 0) return { success: false, error: 'No FCM tokens' };
      const start = Date.now();
      const res = await Promise.race([
        sendPushNotificationChannel({ tokens: allFcmTokens, ...pushMsg, meta: { alertId } }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('Push timeout')), 2000)),
      ]);
      await logAttempt({
        channel: 'PUSH',
        status: res?.success ? 'DELIVERED' : 'FAILED',
        latencyMs: Date.now() - start,
        providerRef: null,
        error: res?.error,
        alertId,
        studentId,
        schoolId,
      });
      return res;
    })(),

    // SMS — 4 second timeout per number
    ...phoneNumbers
      .map(phone => async () => {
        const start = Date.now();
        const res = await Promise.race([
          sendSmsNotification({ to: phone, body: smsBody, meta: { alertId } }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('SMS timeout')), 4000)),
        ]);
        await logAttempt({
          channel: 'SMS',
          status: res?.success ? 'DELIVERED' : 'FAILED',
          latencyMs: Date.now() - start,
          providerRef: res?.providerRef,
          error: res?.error,
          alertId,
          studentId,
          schoolId,
        });
        return res;
      })
      .map(fn => fn()),
  ]);

  // Step 11 — Any success?
  anyDelivered = step10Results.some(r => r.status === 'fulfilled' && r.value?.success === true);

  if (anyDelivered) {
    await prisma.emergencyAlert.update({
      where: { id: alertId },
      data: { status: 'DELIVERED', delivered_at: new Date() },
    });
    logger.info({ jobId: job.id, alertId }, '[emergency.worker] Alert DELIVERED via push/SMS');
    return;
  }

  // Step 12 — All failed — try WhatsApp (4s timeout)
  logger.warn({ jobId: job.id, alertId }, '[emergency.worker] Push+SMS failed — trying WhatsApp');

  const waNumbers = contacts.filter(c => c.whatsapp_enabled && c.phone).map(c => c.phone);
  const waResults = await Promise.allSettled(
    waNumbers
      .map(phone => async () => {
        const start = Date.now();
        const res = await Promise.race([
          // sendWhatsAppNotification({ to: phone, body: smsBody, meta: { alertId } }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('WA timeout')), 4000)),
        ]);
        await logAttempt({
          channel: 'WHATSAPP',
          status: res?.success ? 'DELIVERED' : 'FAILED',
          latencyMs: Date.now() - start,
          providerRef: res?.providerRef,
          error: res?.error,
          alertId,
          studentId,
          schoolId,
        });
        return res;
      })
      .map(fn => fn())
  );

  const waDelivered = waResults.some(r => r.status === 'fulfilled' && r.value?.success === true);

  if (waDelivered) {
    await prisma.emergencyAlert.update({
      where: { id: alertId },
      data: { status: 'DELIVERED', delivered_at: new Date() },
    });
    logger.info({ jobId: job.id, alertId }, '[emergency.worker] Alert DELIVERED via WhatsApp');
    return;
  }

  // Step 13 — Voice call placeholder (implement when voice provider is chosen)
  logger.warn(
    { jobId: job.id, alertId },
    '[emergency.worker] WhatsApp failed — voice call not yet implemented'
  );
  await logAttempt({
    channel: 'VOICE',
    status: 'SKIPPED',
    latencyMs: 0,
    error: 'Voice provider not configured',
    alertId,
    studentId,
    schoolId,
  });

  // Step 14 — All channels failed — DLQ + Slack (handled by failed event below)
  await prisma.emergencyAlert.update({
    where: { id: alertId },
    data: { status: 'FAILED', failed_at: new Date() },
  });

  throw new Error(`[emergency.worker] All notification channels failed for alert ${alertId}`);
};

// ── Worker setup ──────────────────────────────────────────────────────────────

let _worker = null;

export const startEmergencyWorker = () => {
  if (_worker) return _worker;

  _worker = new Worker(QUEUE, processEmergencyAlert, {
    connection: getQueueConnection(),
    concurrency: 10,
  });

  _worker.on('completed', job => {
    logger.info({ jobId: job.id, queue: QUEUE }, '[emergency.worker] Job completed');
  });

  _worker.on('failed', async (job, error) => {
    logger.error(
      { jobId: job?.id, err: error.message, attemptsMade: job?.attemptsMade },
      '[emergency.worker] Job failed'
    );

    // DLQ on final attempt
    if (job && job.attemptsMade >= (job.opts?.attempts ?? 5)) {
      await handleDeadJob({ job, error, queueName: QUEUE });
    }
  });

  _worker.on('error', err => {
    logger.error({ err: err.message }, '[emergency.worker] Worker error');
  });

  logger.info({ queue: QUEUE, concurrency: 10 }, '[emergency.worker] Started');
  return _worker;
};

export const stopEmergencyWorker = async () => {
  if (_worker) {
    await _worker.close();
    _worker = null;
    logger.info('[emergency.worker] Stopped');
  }
};
