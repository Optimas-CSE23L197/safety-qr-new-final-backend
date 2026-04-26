// =============================================================================
// orchestrator/workers/emergency.worker.js — RESQID
// Processes emergency_queue. ALWAYS ON. Sacred pipeline.
//
// Steps 7–15 of the emergency alert pipeline.
// FCM removed. Expo push tokens only (expo_push_token field).
// FIXED: SMS now uses DLT template with named variables.
// =============================================================================

import { Worker } from 'bullmq';
import { getQueueConnection } from '../queues/queue.connection.js';
import { QUEUE_NAMES } from '../queues/queue.names.js';
import { handleDeadJob } from '../dlq/dlq.handler.js';
import { sendPushNotificationChannel } from '../notifications/channel/push.js';
import { sendSmsNotification } from '../notifications/channel/sms.js';
import { prisma } from '#config/prisma.js';
import { logger } from '#config/logger.js';
import { decryptField } from '#shared/security/encryption.js';
import { invalidateScanCache } from '#shared/cache/scan.cache.js';

const QUEUE = QUEUE_NAMES.EMERGENCY_ALERTS;

// ── Contact loaders ───────────────────────────────────────────────────────────

const safeDecrypt = encrypted => {
  if (!encrypted) return null;
  try {
    return decryptField(encrypted);
  } catch (err) {
    logger.error({ err: err.message }, '[emergency.worker] Decrypt failed');
    return null;
  }
};

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
          name: true,
          relationship: true,
        },
      },
    },
  });

  return (emergency?.contacts ?? []).map(c => ({
    ...c,
    phone: safeDecrypt(c.phone_encrypted),
  }));
};

/**
 * Load Expo push tokens for the student's linked parents.
 * Uses expo_push_token — no FCM.
 */
const loadParentExpoTokens = async studentId => {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: {
      parentLinks: {
        select: {
          parent: {
            select: {
              devices: {
                where: { is_active: true },
                select: { expo_push_token: true },
              },
            },
          },
        },
      },
    },
  });

  return (student?.parentLinks ?? [])
    .flatMap(pl => pl.parent?.devices?.map(d => d.expo_push_token) ?? [])
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
  metadata = {},
}) => {
  try {
    // Check if log already exists for this alert + channel (prevents duplicates on retry)
    const existing = await prisma.notification.findFirst({
      where: {
        channel,
        metadata: { path: ['alertId'], equals: alertId },
      },
    });

    if (existing) {
      // Update existing record with latest attempt info
      await prisma.notification.update({
        where: { id: existing.id },
        data: {
          status,
          latency_ms: latencyMs,
          provider_ref: providerRef ?? null,
          error: error ?? null,
          metadata: { alertId, ...metadata, attempts: (existing.metadata?.attempts || 0) + 1 },
        },
      });
      logger.debug({ alertId, channel }, '[emergency.worker] Updated existing notification log');
      return;
    }

    // Create new record
    await prisma.notification.create({
      data: {
        channel,
        status,
        latency_ms: latencyMs,
        provider_ref: providerRef ?? null,
        error: error ?? null,
        student_id: studentId ?? null,
        school_id: schoolId ?? null,
        metadata: { alertId, ...metadata, attempts: 1 },
      },
    });
  } catch (err) {
    logger.error({ err: err.message }, '[emergency.worker] Failed to write notification log');
  }
};

// ── Post-delivery side effects ────────────────────────────────────────────────

const updateScanLogDelivery = async ({ scanLogId, deliveredChannels, failedChannels }) => {
  if (!scanLogId) return;
  try {
    await prisma.scanLog.update({
      where: { id: scanLogId },
      data: {
        emergency_dispatched: true,
        dispatched_at: new Date(),
        dispatched_channels: deliveredChannels,
        failed_channels: failedChannels,
      },
    });
  } catch (err) {
    logger.error(
      { err: err.message, scanLogId },
      '[emergency.worker] updateScanLogDelivery failed'
    );
  }
};

const createEmergencyDashboardNotification = async ({ schoolId, studentName, studentId }) => {
  try {
    const admins = await prisma.schoolUser.findMany({
      where: { school_id: schoolId, is_active: true },
      select: { id: true },
    });

    if (!admins.length) return;

    await prisma.dashboardNotification.createMany({
      data: admins.map(admin => ({
        user_id: admin.id,
        user_type: 'SCHOOL_ADMIN',
        school_user_id: admin.id,
        type: 'EMERGENCY_FIRED',
        title: 'Emergency Alert Fired',
        body: `Emergency card scan alert dispatched for ${studentName ?? 'a student'}.`,
        school_id: schoolId,
        metadata: { studentId },
        read: false,
      })),
      skipDuplicates: true,
    });
  } catch (err) {
    logger.error(
      { err: err.message, schoolId },
      '[emergency.worker] createEmergencyDashboardNotification failed'
    );
  }
};

// ── Job processor ─────────────────────────────────────────────────────────────

export const processEmergencyAlert = async job => {
  const { alertId, studentId, schoolId, studentName, schoolName, scannedAt, tokenId, scanLogId } =
    job.data?.payload ?? {};

  if (!alertId || !studentId || !schoolId) {
    throw new Error('[emergency.worker] Missing alertId, studentId, or schoolId');
  }

  logger.info({ jobId: job.id, alertId, studentId }, '[emergency.worker] Processing alert');

  // Step 8 — Load contacts + Expo tokens
  const [contacts, parentExpoTokens] = await Promise.all([
    loadAlertContacts(studentId),
    loadParentExpoTokens(studentId),
  ]);

  const phoneNumbers = contacts.map(c => c.phone).filter(Boolean);

  const pushMsg = {
    title: 'Emergency Alert',
    body: `${studentName ?? 'A student'}'s ResQID card was scanned. Open app for details.`,
    data: { alertId, studentId, type: 'EMERGENCY' },
  };

  // Format time for SMS (e.g., "10:30 AM")
  const formattedTime = scannedAt
    ? new Date(scannedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
    : new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

  const smsVariables = {
    student_name: studentName ?? 'A student',
    school_name: schoolName ?? 'school',
    scan_time: formattedTime,
  };

  const deliveredChannels = [];
  const failedChannels = [];

  // Step 10 — Push (2s timeout) + SMS per contact (4s timeout) in parallel
  const step10Results = await Promise.allSettled([
    // Expo push
    (async () => {
      if (!parentExpoTokens.length) {
        failedChannels.push('PUSH');
        return { success: false, error: 'No Expo push tokens' };
      }
      const start = Date.now();
      try {
        const res = await Promise.race([
          sendPushNotificationChannel({
            tokens: parentExpoTokens,
            ...pushMsg,
            meta: { alertId },
          }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('Push timeout')), 2000)),
        ]);
        res?.success ? deliveredChannels.push('PUSH') : failedChannels.push('PUSH');
        await logAttempt({
          channel: 'PUSH',
          status: res?.success ? 'DELIVERED' : 'FAILED',
          latencyMs: Date.now() - start,
          error: res?.error,
          alertId,
          studentId,
          schoolId,
        });
        return res;
      } catch (err) {
        failedChannels.push('PUSH');
        await logAttempt({
          channel: 'PUSH',
          status: 'FAILED',
          latencyMs: Date.now() - start,
          error: err.message,
          alertId,
          studentId,
          schoolId,
        });
        return { success: false, error: err.message };
      }
    })(),

    // SMS — per contact, 4s timeout each
    ...phoneNumbers.map(phone =>
      (async () => {
        const start = Date.now();
        try {
          const res = await Promise.race([
            sendSmsNotification({
              to: phone,
              templateId: process.env.MSG91_EMERGENCY_TEMPLATE_ID,
              variables: smsVariables,
              meta: { alertId },
            }),
            new Promise((_, rej) => setTimeout(() => rej(new Error('SMS timeout')), 4000)),
          ]);
          res?.success ? deliveredChannels.push('SMS') : failedChannels.push('SMS');
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
        } catch (err) {
          failedChannels.push('SMS');
          await logAttempt({
            channel: 'SMS',
            status: 'FAILED',
            latencyMs: Date.now() - start,
            error: err.message,
            alertId,
            studentId,
            schoolId,
          });
          return { success: false, error: err.message };
        }
      })()
    ),
  ]);

  // Step 11 — Any channel succeeded?
  const anyDelivered = step10Results.some(
    r => r.status === 'fulfilled' && r.value?.success === true
  );

  if (anyDelivered) {
    logger.info(
      { jobId: job.id, alertId, deliveredChannels },
      '[emergency.worker] Alert DELIVERED'
    );

    // [I-1] Invalidate scan cache
    if (tokenId) {
      invalidateScanCache(tokenId).catch(err =>
        logger.warn({ err: err.message, tokenId }, '[emergency.worker] Cache invalidation failed')
      );
    }

    // [I-2] Update ScanLog
    await updateScanLogDelivery({ scanLogId, deliveredChannels, failedChannels });

    // [I-3] Notify school admin dashboard
    await createEmergencyDashboardNotification({ schoolId, studentName, studentId });

    return;
  }

  // Step 12 — WhatsApp skipped (not configured)
  logger.warn(
    { jobId: job.id, alertId },
    '[emergency.worker] Push+SMS failed — WhatsApp not configured'
  );
  await logAttempt({
    channel: 'WHATSAPP',
    status: 'SKIPPED',
    latencyMs: 0,
    error: 'WhatsApp not configured',
    alertId,
    studentId,
    schoolId,
  });

  // Step 13 — Voice call placeholder
  logger.warn({ jobId: job.id, alertId }, '[emergency.worker] Voice call not implemented');
  await logAttempt({
    channel: 'VOICE',
    status: 'SKIPPED',
    latencyMs: 0,
    error: 'Voice provider not configured',
    alertId,
    studentId,
    schoolId,
  });

  // Step 14 — All channels failed
  throw new Error(`[emergency.worker] All notification channels failed for alert ${alertId}`);
};

// ── Worker setup ──────────────────────────────────────────────────────────────

let _worker = null;

export const startEmergencyWorker = () => {
  if (_worker) return _worker;

  _worker = new Worker(QUEUE, processEmergencyAlert, {
    connection: getQueueConnection(),
    concurrency: 5,
    stalledInterval: 30_000,
    maxStalledCount: 2,
    lockDuration: 15_000,
  });

  _worker.on('completed', job => {
    logger.info({ jobId: job.id, queue: QUEUE }, '[emergency.worker] Job completed');
  });

  _worker.on('failed', async (job, error) => {
    logger.error(
      { jobId: job?.id, err: error.message, attemptsMade: job?.attemptsMade },
      '[emergency.worker] Job failed'
    );
    if (job && job.attemptsMade >= (job.opts?.attempts ?? 5)) {
      await handleDeadJob({ job, error, queueName: QUEUE });
    }
  });

  _worker.on('error', err => {
    logger.error({ err: err.message }, '[emergency.worker] Worker error');
  });

  logger.info({ queue: QUEUE, concurrency: 5 }, '[emergency.worker] Started');
  return _worker;
};

export const stopEmergencyWorker = async () => {
  if (_worker) {
    await _worker.close();
    _worker = null;
    logger.info('[emergency.worker] Stopped');
  }
};
