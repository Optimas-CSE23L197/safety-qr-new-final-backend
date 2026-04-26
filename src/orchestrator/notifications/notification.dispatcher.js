// =============================================================================
// orchestrator/notifications/notification.dispatcher.js — RESQID
//
// Event type → channel routing.
// Push: parents/guardians only (emergency, card, anomaly, scan)
// SMS: parents + school admins
// Email: onboarding, security alerts, welcome, renewal, anomaly
// SSE: school dashboard — all order events + emergency + scan
// =============================================================================

import { EVENTS } from '../events/event.types.js';
import { sendSmsNotification } from './channel/sms.js';
import { sendPushNotificationChannel } from './channel/push.js';
import { pushSSE } from '#infrastructure/sse/sse.service.js';
import { smsTemplates, emailTemplates, pushTemplates } from './notification.templates.js';
import { getEmail } from '#infrastructure/email/email.index.js';
import { prisma } from '#config/prisma.js';
import { logger } from '#config/logger.js';
import { getSms } from '#infrastructure/sms/sms.index.js';

// ── Email send helper ────────────────────────────────────────────────────────

const sendReactEmail = async ({ to, tmpl, meta }) => {
  if (!to || !tmpl?.Component) {
    if (!tmpl?.Component)
      logger.warn(
        { to, subject: tmpl?.subject },
        '[dispatcher] Email template Component missing — skipping'
      );
    return { success: false, error: 'Missing to or template' };
  }
  try {
    const email = getEmail();
    return await email.sendReactTemplate(tmpl.Component, tmpl.props, { to, subject: tmpl.subject });
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
      select: { email: true, name: true },
    });
    return { email: user?.email ?? null, name: user?.name ?? null };
  }
  return { email: null, name: null };
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
    meta: { ...meta, ...extraMeta },
  });
  return r;
};

const sendParallel = async tasks => {
  const results = await Promise.allSettled(tasks);
  for (const result of results) {
    if (result.status === 'rejected')
      logger.error({ err: result.reason?.message }, '[dispatcher] Channel task rejected');
  }
  return results;
};

const sseToSchoolAdmins = async (schoolId, eventType, data) => {
  if (!schoolId) return;
  try {
    const userIds = await loadSchoolAdminUserIds(schoolId);
    for (const userId of userIds) pushSSE(userId, { type: eventType, data });
  } catch (err) {
    logger.error({ err: err.message, schoolId, eventType }, '[dispatcher] SSE push failed');
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// DISPATCH
// ═══════════════════════════════════════════════════════════════════════════════

export const dispatch = async event => {
  const { type, payload, schoolId, meta } = event;
  const logMeta = { eventType: type, schoolId, orderId: meta?.orderId, studentId: meta?.studentId };
  const getSchool = makeSchoolLoader(schoolId);

  try {
    switch (type) {
      // ── EMERGENCY → push + SMS to parents ────────────────────────────────
      case EVENTS.EMERGENCY_ALERT_TRIGGERED:
      case EVENTS.EMERGENCY_ALERT_ESCALATED: {
        const {
          studentName,
          schoolName,
          scannedAt,
          location,
          parentContacts,
          parentExpoTokens,
          parentEmail,
        } = payload;

        const push = pushTemplates.EMERGENCY_ALERT({
          studentName,
          location: location ?? schoolName ?? 'unknown',
        });
        const smsBody = smsTemplates.EMERGENCY_ALERT({
          studentName,
          location: location ?? schoolName ?? 'unknown',
          scannedAt,
        });

        await timedSend(
          () =>
            sendPushNotificationChannel({ tokens: parentExpoTokens ?? [], ...push, meta: logMeta }),
          'PUSH',
          logMeta
        );

        if (parentContacts?.length) {
          await sendParallel(
            parentContacts.map(phone =>
              timedSend(
                () => sendSmsNotification({ to: phone, body: smsBody, meta: logMeta }),
                'SMS',
                logMeta
              )
            )
          );
        }

        if (parentEmail) {
          const tmpl = emailTemplates.EMERGENCY_ALERT_LOG({
            studentName,
            schoolName,
            location,
            scannedAt,
            dispatchResults: {},
          });
          await timedSend(
            () => sendReactEmail({ to: parentEmail, tmpl, meta: logMeta }),
            'EMAIL',
            logMeta
          );
        }

        break;
      }

      // ── OTP → SMS only ────────────────────────────────────────────────────
      case EVENTS.USER_OTP_REQUESTED: {
        const { phone, otp } = payload;
        const sms = getSms();
        await timedSend(() => sms.sendOtp(phone, otp), 'SMS', logMeta);
        break;
      }

      // ── New device login → email to user ──────────────────────────────────
      case EVENTS.USER_DEVICE_LOGIN_NEW: {
        const { name, device, location, time } = payload;
        const { email } = await loadUserContacts(payload.userId, payload.userType);
        if (email) {
          const tmpl = emailTemplates.USER_DEVICE_LOGIN_NEW({ name, device, location, time });
          await timedSend(
            () => sendReactEmail({ to: email, tmpl, meta: logMeta }),
            'EMAIL',
            logMeta
          );
        }
        break;
      }

      // ── ORDER CONFIRMED → SMS + SSE ────────────────────────────────────────
      case EVENTS.ORDER_CONFIRMED: {
        const { orderNumber, cardCount, amount } = payload;
        const school = await getSchool();
        const tmpl = emailTemplates.ORDER_CONFIRMED({
          schoolName: school?.name ?? 'School',
          orderNumber,
          cardCount,
          amount,
        });
        if (school?.email)
          await timedSend(
            () => sendReactEmail({ to: school.email, tmpl, meta: logMeta }),
            'EMAIL',
            logMeta
          );
        await sseToSchoolAdmins(schoolId, type, { orderNumber, cardCount, amount });
        break;
      }

      // ── ORDER EVENTS → SSE only ───────────────────────────────────────────
      case EVENTS.ORDER_ADVANCE_PAYMENT_RECEIVED:
        await sseToSchoolAdmins(schoolId, type, {
          orderNumber: payload.orderNumber,
          amount: payload.amount,
        });
        break;

      case EVENTS.PARTIAL_PAYMENT_CONFIRMED:
        await sseToSchoolAdmins(schoolId, type, {
          orderNumber: payload.orderNumber,
          amount: payload.amount,
        });
        break;

      case EVENTS.PARTIAL_INVOICE_GENERATED:
        await sseToSchoolAdmins(schoolId, type, {
          orderNumber: payload.orderNumber,
          amount: payload.amount,
          invoiceUrl: payload.invoiceUrl,
        });
        break;

      case EVENTS.ORDER_TOKEN_GENERATION_COMPLETE:
        await sseToSchoolAdmins(schoolId, type, { orderNumber: payload.orderNumber });
        break;

      case EVENTS.ORDER_CARD_DESIGN_COMPLETE:
        await sseToSchoolAdmins(schoolId, type, {
          orderNumber: payload.orderNumber,
          reviewUrl: payload.reviewUrl,
        });
        break;

      case EVENTS.DESIGN_APPROVED:
        await sseToSchoolAdmins(schoolId, type, { orderNumber: payload.orderNumber });
        break;

      // ── ORDER SHIPPED → SMS + SSE ─────────────────────────────────────────
      case EVENTS.ORDER_SHIPPED: {
        const { orderNumber, trackingId, trackingUrl, schoolPhone } = payload;
        const smsBody = smsTemplates.ORDER_SHIPPED({ orderNumber, trackingId });
        const tasks = [];
        if (schoolPhone)
          tasks.push(
            timedSend(
              () => sendSmsNotification({ to: schoolPhone, body: smsBody, meta: logMeta }),
              'SMS',
              logMeta
            )
          );
        await sendParallel(tasks);
        await sseToSchoolAdmins(schoolId, type, { orderNumber, trackingId, trackingUrl });
        break;
      }

      // ── ORDER DELIVERED → email + SSE ──────────────────────────────────────
      case EVENTS.ORDER_DELIVERED: {
        const { orderNumber } = payload;
        const school = await getSchool();
        const tmpl = emailTemplates.ORDER_DELIVERED({
          schoolName: school?.name ?? 'School',
          orderNumber,
        });
        if (school?.email)
          await timedSend(
            () => sendReactEmail({ to: school.email, tmpl, meta: logMeta }),
            'EMAIL',
            logMeta
          );
        await sseToSchoolAdmins(schoolId, type, { orderNumber });
        break;
      }

      // ── BALANCE INVOICE → SMS + SSE ───────────────────────────────────────
      case EVENTS.ORDER_BALANCE_INVOICE_ISSUED: {
        const { orderNumber, amount, dueDate, invoiceUrl, schoolPhone } = payload;
        const smsBody = smsTemplates.BALANCE_INVOICE_DUE({ orderNumber, amount });
        if (schoolPhone)
          await timedSend(
            () => sendSmsNotification({ to: schoolPhone, body: smsBody, meta: logMeta }),
            'SMS',
            logMeta
          );
        await sseToSchoolAdmins(schoolId, type, { orderNumber, amount, dueDate, invoiceUrl });
        break;
      }

      // ── ORDER COMPLETED → SSE only ────────────────────────────────────────
      case EVENTS.ORDER_COMPLETED:
        await sseToSchoolAdmins(schoolId, type, { orderNumber: payload.orderNumber });
        break;

      // ── ORDER REFUNDED → email + SSE ──────────────────────────────────────
      case EVENTS.ORDER_REFUNDED: {
        const { orderNumber, amount } = payload;
        const school = await getSchool();
        const tmpl = emailTemplates.ORDER_REFUNDED({
          schoolName: school?.name ?? 'School',
          orderNumber,
          amount,
        });
        if (school?.email)
          await timedSend(
            () => sendReactEmail({ to: school.email, tmpl, meta: logMeta }),
            'EMAIL',
            logMeta
          );
        await sseToSchoolAdmins(schoolId, type, { orderNumber, amount });
        break;
      }

      // ── SCHOOL ONBOARDED → email ──────────────────────────────────────────
      case EVENTS.SCHOOL_ONBOARDED:
      case EVENTS.SCHOOL_USER_ONBOARDED: {
        const {
          schoolName,
          adminName,
          adminEmail,
          tempPassword,
          dashboardUrl,
          planName,
          planExpiry,
          cardCount,
        } = payload;
        if (adminEmail) {
          const tmpl = emailTemplates.SCHOOL_ONBOARDED({
            schoolName,
            adminName,
            adminEmail,
            tempPassword,
            dashboardUrl,
            planName,
            planExpiry,
            cardCount,
          });
          await timedSend(
            () => sendReactEmail({ to: adminEmail, tmpl, meta: logMeta }),
            'EMAIL',
            logMeta
          );
        }
        break;
      }

      // ── SCHOOL RENEWAL → email + SMS ─────────────────────────────────────
      case EVENTS.SCHOOL_RENEWAL_DUE: {
        const { schoolName, adminEmail, schoolPhone, expiryDate, renewUrl } = payload;
        const tmpl = emailTemplates.SCHOOL_RENEWAL_DUE({ schoolName, expiryDate, renewUrl });
        const smsBody = smsTemplates.SCHOOL_RENEWAL_DUE({ schoolName, expiryDate, renewUrl });
        await sendParallel([
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
        ]);
        break;
      }

      // ── STUDENT CARD EXPIRING → push only ─────────────────────────────────
      case EVENTS.STUDENT_CARD_EXPIRING: {
        const { studentName, daysLeft, parentExpoTokens } = payload;
        const push = pushTemplates.STUDENT_CARD_EXPIRING({ studentName, daysLeft });
        await timedSend(
          () =>
            sendPushNotificationChannel({ tokens: parentExpoTokens ?? [], ...push, meta: logMeta }),
          'PUSH',
          logMeta
        );
        break;
      }

      // ── STUDENT QR SCANNED → push to parent ───────────────────────────────
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

      // ── PARENT WELCOME → email ────────────────────────────────────────────
      case EVENTS.PARENT_EMAIL_VERIFIED: {
        const {
          parentName,
          parentEmail,
          studentName,
          studentClass,
          schoolName,
          cardId,
          appStoreUrl,
          playStoreUrl,
        } = payload;
        if (parentEmail) {
          const tmpl = emailTemplates.PARENT_ONBOARDED({
            parentName,
            phone: null,
            studentName,
            studentClass,
            schoolName,
            cardId,
            appStoreUrl,
            playStoreUrl,
          });
          await timedSend(
            () => sendReactEmail({ to: parentEmail, tmpl, meta: logMeta }),
            'EMAIL',
            logMeta
          );
        }
        break;
      }

      // ── PARENT REGISTERED → SMS ───────────────────────────────────────────
      case EVENTS.PARENT_REGISTERED: {
        const { phone, parentName } = payload;
        const smsBody = smsTemplates.PARENT_REGISTERED({ parentName });
        if (phone)
          await timedSend(
            () => sendSmsNotification({ to: phone, body: smsBody, meta: logMeta }),
            'SMS',
            logMeta
          );
        break;
      }

      // ── PARENT CARD LINKED → push + SMS ───────────────────────────────────
      case EVENTS.PARENT_CARD_LINKED: {
        const { studentName, parentPhone, parentExpoTokens } = payload;
        const push = pushTemplates.PARENT_CARD_LINKED({ studentName });
        const smsBody = smsTemplates.CARD_LINKED({ studentName });
        await sendParallel([
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
        ]);
        break;
      }

      // ── PARENT CARD LOCKED → push + SMS + email ───────────────────────────
      case EVENTS.PARENT_CARD_LOCKED: {
        const { parentName, studentName, parentEmail, parentPhone, parentExpoTokens } = payload;
        const push = pushTemplates.PARENT_CARD_LOCKED({ studentName });
        const smsBody = smsTemplates.CARD_LOCKED({ studentName });
        const tmpl = emailTemplates.PARENT_CARD_LOCKED({
          parentName: parentName ?? 'Parent',
          studentName,
        });
        await sendParallel([
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
          parentEmail
            ? timedSend(
                () => sendReactEmail({ to: parentEmail, tmpl, meta: logMeta }),
                'EMAIL',
                logMeta
              )
            : Promise.resolve(),
        ]);
        break;
      }

      // ── PARENT CARD REPLACE → SMS only ────────────────────────────────────
      case EVENTS.PARENT_CARD_REPLACE_REQUESTED: {
        const { studentName, parentPhone } = payload;
        const smsBody = smsTemplates.CARD_REPLACE_REQUESTED({ studentName });
        if (parentPhone)
          await timedSend(
            () => sendSmsNotification({ to: parentPhone, body: smsBody, meta: logMeta }),
            'SMS',
            logMeta
          );
        break;
      }

      // ── PARENT ACCOUNT DELETED → SMS ──────────────────────────────────────
      case EVENTS.PARENT_ACCOUNT_DELETED: {
        const { parentName, parentPhone } = payload;
        const smsBody = smsTemplates.ACCOUNT_DELETED({ parentName });
        if (parentPhone)
          await timedSend(
            () => sendSmsNotification({ to: parentPhone, body: smsBody, meta: logMeta }),
            'SMS',
            logMeta
          );
        break;
      }

      // ── PARENT PHONE CHANGED → SMS old + new ──────────────────────────────
      case EVENTS.PARENT_PHONE_CHANGED: {
        const { oldPhone, newPhone } = payload;
        const smsBody = smsTemplates.PHONE_CHANGED({ newPhone });
        await sendParallel([
          oldPhone
            ? timedSend(
                () =>
                  sendSmsNotification({
                    to: oldPhone,
                    body: `ResQID: Your phone was changed to ${newPhone}. Not you? Contact support. -RESQID`,
                    meta: logMeta,
                  }),
                'SMS',
                logMeta
              )
            : Promise.resolve(),
          timedSend(
            () => sendSmsNotification({ to: newPhone, body: smsBody, meta: logMeta }),
            'SMS',
            logMeta
          ),
        ]);
        break;
      }

      // ── PARENT EMAIL CHANGED → email to old address ───────────────────────
      case EVENTS.PARENT_EMAIL_CHANGED: {
        const { parentName, oldEmail, newEmail } = payload;
        if (oldEmail) {
          const tmpl = emailTemplates.PARENT_EMAIL_CHANGED({ parentName, oldEmail, newEmail });
          await timedSend(
            () => sendReactEmail({ to: oldEmail, tmpl, meta: logMeta }),
            'EMAIL',
            logMeta
          );
        }
        break;
      }

      // ── PARENT CHILD UNLINKED → push + SMS ────────────────────────────────
      case EVENTS.PARENT_CHILD_UNLINKED: {
        const { studentName, parentExpoTokens, parentPhone } = payload;
        const push = pushTemplates.PARENT_CHILD_UNLINKED({ studentName });
        const smsBody = smsTemplates.CHILD_UNLINKED({ studentName });
        await sendParallel([
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
        ]);
        break;
      }

      // ── CARD RENEWAL REQUESTED → SMS to parent + email to admin ───────────
      case EVENTS.PARENT_CARD_RENEWAL_REQUESTED: {
        const { studentName, schoolName, parentPhone, adminEmail } = payload;
        const smsBody = smsTemplates.RENEWAL_REQUESTED({ studentName });
        const tmpl = emailTemplates.PARENT_CARD_RENEWAL_REQUESTED({
          studentName,
          schoolName,
          parentPhone,
        });
        await sendParallel([
          parentPhone
            ? timedSend(
                () => sendSmsNotification({ to: parentPhone, body: smsBody, meta: logMeta }),
                'SMS',
                logMeta
              )
            : Promise.resolve(),
          adminEmail
            ? timedSend(
                () => sendReactEmail({ to: adminEmail, tmpl, meta: logMeta }),
                'EMAIL',
                logMeta
              )
            : Promise.resolve(),
        ]);
        break;
      }

      // ── ANOMALY DETECTED → push + email to parent ─────────────────────────
      case EVENTS.ANOMALY_DETECTED: {
        const { studentName, anomalyType, location, detectedAt, parentExpoTokens, parentEmail } =
          payload;
        const push = pushTemplates.ANOMALY_DETECTED({ studentName, anomalyType });
        const tmpl = emailTemplates.ANOMALY_DETECTED({
          studentName,
          anomalyType,
          location,
          detectedAt,
        });
        await sendParallel([
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
          parentEmail
            ? timedSend(
                () => sendReactEmail({ to: parentEmail, tmpl, meta: logMeta }),
                'EMAIL',
                logMeta
              )
            : Promise.resolve(),
        ]);
        break;
      }

      // ── INTERNAL ALERT → email ────────────────────────────────────────────
      case EVENTS.INTERNAL_ALERT: {
        const { alertType, message, data } = payload;
        const tmpl = emailTemplates.INTERNAL_ALERT({ alertType, message, data });
        const internalEmail = process.env.INTERNAL_ALERT_EMAIL ?? 'team@getresqid.in';
        await timedSend(
          () => sendReactEmail({ to: internalEmail, tmpl, meta: logMeta }),
          'EMAIL',
          logMeta
        );
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
