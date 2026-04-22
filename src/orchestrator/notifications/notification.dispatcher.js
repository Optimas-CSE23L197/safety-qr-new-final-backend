// =============================================================================
// orchestrator/notifications/notification.dispatcher.js — RESQID
//
// Event type → channel routing.
// Email templates use React Email components via ses.adapter.sendReactTemplate().
// SMS/push content comes from notification.templates.js (single source of truth).
// WhatsApp removed. Firebase/FCM removed. Expo tokens only.
// =============================================================================

import { EVENTS } from '../events/event.types.js';
import { sendSmsNotification } from './channel/sms.js';
import { sendEmailNotification } from './channel/email.js';
import { sendPushNotificationChannel } from './channel/push.js';
import { pushSSE } from '#infrastructure/sse/sse.service.js';
import { smsTemplates, emailTemplates, pushTemplates } from './notification.templates.js';
import { getEmail } from '#infrastructure/email/email.index.js';
import { prisma } from '#config/prisma.js';
import { logger } from '#config/logger.js';

// ── Email send helper — handles React Email component or stub gracefully ───────

/**
 * Renders a React Email component and sends via SES.
 * If Component is null (stub), logs a warning and skips — never throws.
 */
const sendReactEmail = async ({ to, tmpl, meta }) => {
  if (!to || !tmpl) return { success: false, error: 'Missing to or template' };

  if (!tmpl.Component) {
    logger.warn(
      { to, subject: tmpl.subject, stub: tmpl._stub ?? 'unknown' },
      '[dispatcher] Email template Component not yet wired — skipping send'
    );
    return { success: false, error: 'Template not implemented yet' };
  }

  try {
    const email = getEmail();
    return await email.sendReactTemplate(tmpl.Component, tmpl.props, {
      to,
      subject: tmpl.subject,
    });
  } catch (err) {
    logger.error({ err: err.message, to }, '[dispatcher] sendReactEmail failed');
    return { success: false, error: err.message };
  }
};

// ── Contact loaders ───────────────────────────────────────────────────────────

const loadUserContacts = async (userId, userType) => {
  if (userType === 'PARENT_USER') {
    const user = await prisma.parentUser.findUnique({
      where: { id: userId },
      select: {
        email: true,
        devices: {
          where: { is_active: true },
          select: { expo_push_token: true },
        },
      },
    });
    return {
      email: user?.email ?? null,
      expoTokens: user?.devices?.map(d => d.expo_push_token).filter(Boolean) ?? [],
    };
  }
  if (userType === 'SCHOOL_USER') {
    const user = await prisma.schoolUser.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    return { email: user?.email ?? null, expoTokens: [] };
  }
  if (userType === 'SUPER_ADMIN') {
    const user = await prisma.superAdmin.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    return { email: user?.email ?? null, expoTokens: [] };
  }
  return { email: null, expoTokens: [] };
};

const loadSchoolAdminExpoTokens = async schoolId => {
  if (!schoolId) return [];
  try {
    const users = await prisma.schoolUser.findMany({
      where: { school_id: schoolId, is_active: true },
      select: {
        devices: {
          where: { is_active: true },
          select: { expo_push_token: true },
        },
      },
    });
    return users.flatMap(u => u.devices?.map(d => d.expo_push_token) ?? []).filter(Boolean);
  } catch (err) {
    logger.error({ err: err.message, schoolId }, '[dispatcher] Failed to load admin Expo tokens');
    return [];
  }
};

const loadSchoolAdminUserIds = async schoolId => {
  if (!schoolId) return [];
  try {
    const users = await prisma.schoolUser.findMany({
      where: { school_id: schoolId, is_active: true },
      select: { id: true },
    });
    return users.map(u => u.id).filter(Boolean);
  } catch (err) {
    logger.error({ err: err.message, schoolId }, '[dispatcher] Failed to load admin userIds');
    return [];
  }
};

const makeSchoolLoader = schoolId => {
  let _cached;
  return async () => {
    if (_cached !== undefined) return _cached;
    if (!schoolId) return (_cached = null);
    try {
      _cached = await prisma.school.findUnique({
        where: { id: schoolId },
        select: { name: true, email: true, phone: true },
      });
    } catch (err) {
      logger.error({ err: err.message, schoolId }, '[dispatcher] Failed to load school');
      _cached = null;
    }
    return _cached;
  };
};

// ── Notification log writer ───────────────────────────────────────────────────

const writeNotificationLog = async ({ channel, status, latencyMs, providerRef, error, meta }) => {
  try {
    // Redact OTP from logs
    const isOtpEvent = meta?.eventType === 'USER_OTP_REQUESTED';
    const safeContent = isOtpEvent ? '[REDACTED - OTP]' : (meta?.content ?? null);

    await prisma.notification.create({
      data: {
        channel,
        status,
        latency_ms: latencyMs,
        provider_ref: providerRef ?? null,
        error: error ?? null,
        school_id: meta?.schoolId ?? null,
        order_id: meta?.orderId ?? null,
        student_id: meta?.studentId ?? null,
        event_type: meta?.eventType ?? null,
        recipient: meta?.recipient ?? meta?.schoolId ?? 'system',
        type: meta?.eventType ?? channel,
        content: safeContent,
        subject: meta?.subject ?? null,
      },
    });
  } catch (err) {
    logger.error({ err: err.message, channel }, '[dispatcher] Failed to write notification log');
  }
};

// ── Channel send helpers ──────────────────────────────────────────────────────

const timedSend = async (sendFn, channel, meta, extraMeta = {}) => {
  const start = Date.now();
  const r = await sendFn();
  await writeNotificationLog({
    channel,
    status: r.success ? 'DELIVERED' : 'FAILED',
    latencyMs: Date.now() - start,
    providerRef: r.providerRef ?? null,
    error: r.error ?? null,
    meta: { ...meta, ...extraMeta }, // MERGE extraMeta into meta
  });
  return r;
};

const sendParallel = async (tasks, meta) => {
  const results = await Promise.allSettled(tasks);
  for (const result of results) {
    if (result.status === 'rejected') {
      logger.error({ err: result.reason?.message, meta }, '[dispatcher] Channel task rejected');
    }
  }
  return results;
};

const sseToSchoolAdmins = async (schoolId, eventType, data) => {
  if (!schoolId) return;
  try {
    const userIds = await loadSchoolAdminUserIds(schoolId);
    for (const userId of userIds) {
      pushSSE(userId, { type: eventType, data });
    }
  } catch (err) {
    logger.error({ err: err.message, schoolId, eventType }, '[dispatcher] SSE push failed');
  }
};

// ── Dispatcher ────────────────────────────────────────────────────────────────

export const dispatch = async event => {
  const { type, payload, schoolId, meta } = event;
  const logMeta = {
    eventType: type,
    schoolId,
    orderId: meta?.orderId,
    studentId: meta?.studentId,
  };

  const getSchool = makeSchoolLoader(schoolId);

  try {
    switch (type) {
      // ── EMERGENCY_ALERT_TRIGGERED → push + SMS ────────────────────────────
      case EVENTS.EMERGENCY_ALERT_TRIGGERED: {
        const { studentName, schoolName, scannedAt, parentContacts, parentExpoTokens } = payload;
        const push = pushTemplates.EMERGENCY_ALERT({ studentName, schoolName });
        const smsBody = smsTemplates.EMERGENCY_ALERT({ studentName, schoolName, scannedAt });

        await timedSend(
          () =>
            sendPushNotificationChannel({ tokens: parentExpoTokens ?? [], ...push, meta: logMeta }),
          'PUSH',
          logMeta,
          { tokenCount: parentExpoTokens?.length ?? 0 } // ADDED
        );

        if (parentContacts?.length) {
          await sendParallel(
            parentContacts.map(phone =>
              timedSend(
                () => sendSmsNotification({ to: phone, body: smsBody, meta: logMeta }),
                'SMS',
                logMeta
              )
            ),
            logMeta
          );
        }
        break;
      }

      // ── USER_OTP_REQUESTED → SMS only (queue retry path) ─────────────────
      case EVENTS.USER_OTP_REQUESTED: {
        const { phone, otp, namespace, expiryMinutes } = payload;
        const body =
          namespace === 'register'
            ? smsTemplates.OTP_REGISTER({ otp, expiryMinutes })
            : smsTemplates.OTP_LOGIN({ otp, expiryMinutes });
        await timedSend(
          () => sendSmsNotification({ to: phone, body, meta: logMeta }),
          'SMS',
          logMeta
        );
        break;
      }

      // ── USER_DEVICE_LOGIN_NEW → email ─────────────────────────────────────
      case EVENTS.USER_DEVICE_LOGIN_NEW: {
        const { userId, userType, name, device, location, time } = payload;
        const contacts = await loadUserContacts(userId, userType);
        if (contacts.email) {
          const tmpl = emailTemplates.USER_DEVICE_LOGIN_NEW({ name, device, location, time });
          await timedSend(
            () => sendReactEmail({ to: contacts.email, tmpl, meta: logMeta }),
            'EMAIL',
            logMeta
          );
        }
        break;
      }

      // ── ORDER_CONFIRMED → push + email + SSE ─────────────────────────────
      case EVENTS.ORDER_CONFIRMED: {
        const { orderNumber, cardCount, amount } = payload;
        const [tokens, school] = await Promise.all([
          loadSchoolAdminExpoTokens(schoolId),
          getSchool(),
        ]);
        const push = pushTemplates.ORDER_CONFIRMED({ orderNumber });
        const tmpl = emailTemplates.ORDER_CONFIRMED({
          schoolName: school?.name ?? 'School',
          orderNumber,
          cardCount,
          amount,
        });

        await sendParallel(
          [
            timedSend(
              () => sendPushNotificationChannel({ tokens, ...push, meta: logMeta }),
              'PUSH',
              logMeta
            ),
            school?.email
              ? timedSend(
                  () => sendReactEmail({ to: school.email, tmpl, meta: logMeta }),
                  'EMAIL',
                  logMeta
                )
              : Promise.resolve(),
          ],
          logMeta
        );

        await sseToSchoolAdmins(schoolId, 'ORDER_CONFIRMED', { orderNumber, cardCount, amount });
        break;
      }

      // ── ORDER_ADVANCE_PAYMENT_RECEIVED → push + email + SSE ──────────────
      case EVENTS.ORDER_ADVANCE_PAYMENT_RECEIVED: {
        const { orderNumber, amount } = payload;
        const [tokens, school] = await Promise.all([
          loadSchoolAdminExpoTokens(schoolId),
          getSchool(),
        ]);
        const push = pushTemplates.ORDER_ADVANCE_PAYMENT_RECEIVED({ orderNumber, amount });
        const tmpl = emailTemplates.ORDER_ADVANCE_PAYMENT_RECEIVED({
          schoolName: school?.name ?? 'School',
          orderNumber,
          amount,
        });

        await sendParallel(
          [
            timedSend(
              () => sendPushNotificationChannel({ tokens, ...push, meta: logMeta }),
              'PUSH',
              logMeta
            ),
            school?.email
              ? timedSend(
                  () => sendReactEmail({ to: school.email, tmpl, meta: logMeta }),
                  'EMAIL',
                  logMeta
                )
              : Promise.resolve(),
          ],
          logMeta
        );

        await sseToSchoolAdmins(schoolId, 'ORDER_ADVANCE_PAYMENT_RECEIVED', {
          orderNumber,
          amount,
        });
        break;
      }

      // ── PARTIAL_PAYMENT_CONFIRMED → push + email + SSE ───────────────────
      case EVENTS.PARTIAL_PAYMENT_CONFIRMED: {
        const { orderNumber, amount } = payload;
        const [tokens, school] = await Promise.all([
          loadSchoolAdminExpoTokens(schoolId),
          getSchool(),
        ]);
        const push = pushTemplates.PARTIAL_PAYMENT_CONFIRMED({ orderNumber, amount });
        const tmpl = emailTemplates.PARTIAL_PAYMENT_CONFIRMED({
          schoolName: school?.name ?? 'School',
          orderNumber,
          amount,
        });

        await sendParallel(
          [
            timedSend(
              () => sendPushNotificationChannel({ tokens, ...push, meta: logMeta }),
              'PUSH',
              logMeta
            ),
            school?.email
              ? timedSend(
                  () => sendReactEmail({ to: school.email, tmpl, meta: logMeta }),
                  'EMAIL',
                  logMeta
                )
              : Promise.resolve(),
          ],
          logMeta
        );

        await sseToSchoolAdmins(schoolId, 'PARTIAL_PAYMENT_CONFIRMED', { orderNumber, amount });
        break;
      }

      // ── PARTIAL_INVOICE_GENERATED → push + email + SSE ───────────────────
      case EVENTS.PARTIAL_INVOICE_GENERATED: {
        const { orderNumber, amount, invoiceUrl } = payload;
        const [tokens, school] = await Promise.all([
          loadSchoolAdminExpoTokens(schoolId),
          getSchool(),
        ]);
        const push = pushTemplates.PARTIAL_INVOICE_GENERATED({ orderNumber, amount });
        const tmpl = emailTemplates.PARTIAL_INVOICE_GENERATED({
          schoolName: school?.name ?? 'School',
          orderNumber,
          amount,
          invoiceUrl,
        });

        await sendParallel(
          [
            timedSend(
              () => sendPushNotificationChannel({ tokens, ...push, meta: logMeta }),
              'PUSH',
              logMeta
            ),
            school?.email
              ? timedSend(
                  () => sendReactEmail({ to: school.email, tmpl, meta: logMeta }),
                  'EMAIL',
                  logMeta
                )
              : Promise.resolve(),
          ],
          logMeta
        );

        await sseToSchoolAdmins(schoolId, 'PARTIAL_INVOICE_GENERATED', {
          orderNumber,
          amount,
          invoiceUrl,
        });
        break;
      }

      // ── ORDER_TOKEN_GENERATION_COMPLETE → push + SSE ──────────────────────
      case EVENTS.ORDER_TOKEN_GENERATION_COMPLETE: {
        const { orderNumber } = payload;
        const tokens = await loadSchoolAdminExpoTokens(schoolId);
        const push = pushTemplates.ORDER_TOKEN_GENERATION_COMPLETE({ orderNumber });
        await timedSend(
          () => sendPushNotificationChannel({ tokens, ...push, meta: logMeta }),
          'PUSH',
          logMeta
        );
        await sseToSchoolAdmins(schoolId, 'ORDER_TOKEN_GENERATION_COMPLETE', { orderNumber });
        break;
      }

      // ── ORDER_CARD_DESIGN_COMPLETE → push + email + SSE ───────────────────
      case EVENTS.ORDER_CARD_DESIGN_COMPLETE: {
        const { orderNumber, reviewUrl } = payload;
        const [tokens, school] = await Promise.all([
          loadSchoolAdminExpoTokens(schoolId),
          getSchool(),
        ]);
        const push = pushTemplates.ORDER_CARD_DESIGN_COMPLETE({ orderNumber });
        const tmpl = emailTemplates.ORDER_CARD_DESIGN_COMPLETE({
          schoolName: school?.name ?? 'School',
          orderNumber,
          reviewUrl,
        });

        await sendParallel(
          [
            timedSend(
              () => sendPushNotificationChannel({ tokens, ...push, meta: logMeta }),
              'PUSH',
              logMeta
            ),
            school?.email
              ? timedSend(
                  () => sendReactEmail({ to: school.email, tmpl, meta: logMeta }),
                  'EMAIL',
                  logMeta
                )
              : Promise.resolve(),
          ],
          logMeta
        );

        await sseToSchoolAdmins(schoolId, 'ORDER_CARD_DESIGN_COMPLETE', { orderNumber, reviewUrl });
        break;
      }

      // ── DESIGN_APPROVED → push + email + SSE ──────────────────────────────
      case EVENTS.DESIGN_APPROVED: {
        const { orderNumber } = payload;
        const [tokens, school] = await Promise.all([
          loadSchoolAdminExpoTokens(schoolId),
          getSchool(),
        ]);
        const push = pushTemplates.DESIGN_APPROVED({ orderNumber });
        const tmpl = emailTemplates.DESIGN_APPROVED({
          schoolName: school?.name ?? 'School',
          orderNumber,
        });

        await sendParallel(
          [
            timedSend(
              () => sendPushNotificationChannel({ tokens, ...push, meta: logMeta }),
              'PUSH',
              logMeta
            ),
            school?.email
              ? timedSend(
                  () => sendReactEmail({ to: school.email, tmpl, meta: logMeta }),
                  'EMAIL',
                  logMeta
                )
              : Promise.resolve(),
          ],
          logMeta
        );

        await sseToSchoolAdmins(schoolId, 'DESIGN_APPROVED', { orderNumber });
        break;
      }

      // ── ORDER_SHIPPED → push + SMS + email + SSE ──────────────────────────
      case EVENTS.ORDER_SHIPPED: {
        const { orderNumber, trackingId, trackingUrl, schoolPhone } = payload;
        const [tokens, school] = await Promise.all([
          loadSchoolAdminExpoTokens(schoolId),
          getSchool(),
        ]);
        const push = pushTemplates.ORDER_SHIPPED({ orderNumber, trackingId });
        const tmpl = emailTemplates.ORDER_SHIPPED({
          schoolName: school?.name ?? 'School',
          orderNumber,
          trackingId,
          trackingUrl,
        });
        const smsBody = smsTemplates.ORDER_SHIPPED({ orderNumber, trackingId });

        await sendParallel(
          [
            timedSend(
              () => sendPushNotificationChannel({ tokens, ...push, meta: logMeta }),
              'PUSH',
              logMeta
            ),
            school?.email
              ? timedSend(
                  () => sendReactEmail({ to: school.email, tmpl, meta: logMeta }),
                  'EMAIL',
                  logMeta
                )
              : Promise.resolve(),
            schoolPhone
              ? timedSend(
                  () => sendSmsNotification({ to: schoolPhone, body: smsBody, meta: logMeta }),
                  'SMS',
                  logMeta
                )
              : Promise.resolve(),
          ],
          logMeta
        );

        await sseToSchoolAdmins(schoolId, 'ORDER_SHIPPED', {
          orderNumber,
          trackingId,
          trackingUrl,
        });
        break;
      }

      // ── ORDER_DELIVERED → push + email + SSE ──────────────────────────────
      case EVENTS.ORDER_DELIVERED: {
        const { orderNumber } = payload;
        const [tokens, school] = await Promise.all([
          loadSchoolAdminExpoTokens(schoolId),
          getSchool(),
        ]);
        const push = pushTemplates.ORDER_DELIVERED({ orderNumber });
        const tmpl = emailTemplates.ORDER_DELIVERED({
          schoolName: school?.name ?? 'School',
          orderNumber,
        });

        await sendParallel(
          [
            timedSend(
              () => sendPushNotificationChannel({ tokens, ...push, meta: logMeta }),
              'PUSH',
              logMeta
            ),
            school?.email
              ? timedSend(
                  () => sendReactEmail({ to: school.email, tmpl, meta: logMeta }),
                  'EMAIL',
                  logMeta
                )
              : Promise.resolve(),
          ],
          logMeta
        );

        await sseToSchoolAdmins(schoolId, 'ORDER_DELIVERED', { orderNumber });
        break;
      }

      // ── ORDER_BALANCE_INVOICE_ISSUED → push + email + SMS + SSE ──────────
      case EVENTS.ORDER_BALANCE_INVOICE_ISSUED: {
        const { orderNumber, amount, dueDate, invoiceUrl, schoolPhone } = payload;
        const [tokens, school] = await Promise.all([
          loadSchoolAdminExpoTokens(schoolId),
          getSchool(),
        ]);
        const push = pushTemplates.ORDER_BALANCE_INVOICE({ orderNumber, amount });
        const tmpl = emailTemplates.ORDER_BALANCE_INVOICE({
          schoolName: school?.name ?? 'School',
          orderNumber,
          amount,
          dueDate,
          invoiceUrl,
        });
        const smsBody = smsTemplates.BALANCE_INVOICE_DUE({ orderNumber, amount });

        await sendParallel(
          [
            timedSend(
              () => sendPushNotificationChannel({ tokens, ...push, meta: logMeta }),
              'PUSH',
              logMeta
            ),
            school?.email
              ? timedSend(
                  () => sendReactEmail({ to: school.email, tmpl, meta: logMeta }),
                  'EMAIL',
                  logMeta
                )
              : Promise.resolve(),
            schoolPhone
              ? timedSend(
                  () => sendSmsNotification({ to: schoolPhone, body: smsBody, meta: logMeta }),
                  'SMS',
                  logMeta
                )
              : Promise.resolve(),
          ],
          logMeta
        );

        await sseToSchoolAdmins(schoolId, 'ORDER_BALANCE_INVOICE_ISSUED', {
          orderNumber,
          amount,
          dueDate,
          invoiceUrl,
        });
        break;
      }

      // ── ORDER_COMPLETED → email + SSE ─────────────────────────────────────
      case EVENTS.ORDER_COMPLETED: {
        const { orderNumber } = payload;
        const school = await getSchool();
        const tmpl = emailTemplates.ORDER_COMPLETED({
          schoolName: school?.name ?? 'School',
          orderNumber,
        });

        if (school?.email) {
          await timedSend(
            () => sendReactEmail({ to: school.email, tmpl, meta: logMeta }),
            'EMAIL',
            logMeta
          );
        }
        await sseToSchoolAdmins(schoolId, 'ORDER_COMPLETED', { orderNumber });
        break;
      }

      // ── ORDER_REFUNDED → push + email + SSE ───────────────────────────────
      case EVENTS.ORDER_REFUNDED: {
        const { orderNumber, amount } = payload;
        const [tokens, school] = await Promise.all([
          loadSchoolAdminExpoTokens(schoolId),
          getSchool(),
        ]);
        const push = pushTemplates.ORDER_REFUNDED({ orderNumber, amount });
        const tmpl = emailTemplates.ORDER_REFUNDED({
          schoolName: school?.name ?? 'School',
          orderNumber,
          amount,
        });

        await sendParallel(
          [
            timedSend(
              () => sendPushNotificationChannel({ tokens, ...push, meta: logMeta }),
              'PUSH',
              logMeta
            ),
            school?.email
              ? timedSend(
                  () => sendReactEmail({ to: school.email, tmpl, meta: logMeta }),
                  'EMAIL',
                  logMeta
                )
              : Promise.resolve(),
          ],
          logMeta
        );

        await sseToSchoolAdmins(schoolId, 'ORDER_REFUNDED', { orderNumber, amount });
        break;
      }

      // ── SCHOOL_ONBOARDED → email ───────────────────────────────────────────
      case EVENTS.SCHOOL_ONBOARDED: {
        const { schoolName, adminName, adminEmail, dashboardUrl } = payload;
        const tmpl = emailTemplates.SCHOOL_ONBOARDED({ schoolName, adminName, dashboardUrl });
        if (adminEmail) {
          await timedSend(
            () => sendReactEmail({ to: adminEmail, tmpl, meta: logMeta }),
            'EMAIL',
            logMeta
          );
        }
        break;
      }

      // ── SCHOOL_RENEWAL_DUE → email + SMS ──────────────────────────────────
      case EVENTS.SCHOOL_RENEWAL_DUE: {
        const { schoolName, adminEmail, schoolPhone, expiryDate, renewUrl } = payload;
        const tmpl = emailTemplates.SCHOOL_RENEWAL_DUE({ schoolName, expiryDate, renewUrl });
        const smsBody = smsTemplates.SCHOOL_RENEWAL_DUE({ schoolName, expiryDate, renewUrl });

        await sendParallel(
          [
            adminEmail
              ? timedSend(
                  () => sendReactEmail({ to: adminEmail, tmpl, meta: logMeta }),
                  'EMAIL',
                  logMeta
                )
              : Promise.resolve(),
            schoolPhone
              ? timedSend(
                  () => sendSmsNotification({ to: schoolPhone, body: smsBody, meta: logMeta }),
                  'SMS',
                  logMeta
                )
              : Promise.resolve(),
          ],
          logMeta
        );
        break;
      }

      // ── STUDENT_CARD_EXPIRING → push + SMS ────────────────────────────────
      case EVENTS.STUDENT_CARD_EXPIRING: {
        const { studentName, expiryDate, daysLeft, parentPhone, parentExpoTokens } = payload;
        const push = pushTemplates.STUDENT_CARD_EXPIRING({ studentName, daysLeft });
        const smsBody = smsTemplates.STUDENT_CARD_EXPIRING({ studentName, expiryDate });

        await sendParallel(
          [
            timedSend(
              () =>
                sendPushNotificationChannel({
                  tokens: parentExpoTokens ?? [],
                  ...push,
                  meta: logMeta,
                }),
              'PUSH',
              logMeta
            ),
            parentPhone
              ? timedSend(
                  () => sendSmsNotification({ to: parentPhone, body: smsBody, meta: logMeta }),
                  'SMS',
                  logMeta
                )
              : Promise.resolve(),
          ],
          logMeta
        );
        break;
      }

      // ── STUDENT_QR_SCANNED → push only ────────────────────────────────────
      case EVENTS.STUDENT_QR_SCANNED: {
        const { studentName, location, parentExpoTokens, notifyEnabled } = payload;
        if (notifyEnabled && parentExpoTokens?.length) {
          const push = pushTemplates.STUDENT_QR_SCANNED({ studentName, location });
          await timedSend(
            () => sendPushNotificationChannel({ tokens: parentExpoTokens, ...push, meta: logMeta }),
            'PUSH',
            logMeta
          );
        }
        break;
      }

      default:
        logger.debug({ type }, '[dispatcher] No notification rule for event type — skipping');
    }
  } catch (err) {
    logger.error({ err: err.message, eventType: type, schoolId }, '[dispatcher] Dispatch error');
    throw err;
  }
};
