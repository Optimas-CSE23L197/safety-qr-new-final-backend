// =============================================================================
// orchestrator/notifications/notification.dispatcher.js — RESQID
// Event type → channel decision.
// Adding a new event notification = add a case here + template in templates.js.
// Zero channel logic lives anywhere else.
//
// FIXED:
//   [F-1] Removed sendWhatsAppNotification import — WhatsApp is stubbed/commented out.
//         SCHOOL_RENEWAL_DUE and ORDER_BALANCE_INVOICE_ISSUED WhatsApp calls replaced
//         with SMS fallback (easily swappable when MSG91 WhatsApp goes live).
//   [F-2] EMERGENCY_ALERT_TRIGGERED now fires Push first, then SMS on push result —
//         priority order per spec (Push → SMS), not blind parallel.
//   [F-3] sendParallel now wraps each task with notification log writing.
//   [F-4] latencyMs measured per-channel via per-task timing.
//   [F-5] loadSchool() lazy loader — single DB call per dispatch, not repeated per case.
// =============================================================================

import { EVENTS } from '../events/event.types.js';
import { sendSmsNotification } from './channel/sms.js';
import { sendEmailNotification } from './channel/email.js';
import { sendPushNotificationChannel } from './channel/push.js';
import { smsTemplates, emailTemplates, pushTemplates } from './notification.templates.js';
import { prisma } from '#config/prisma.js';
import { logger } from '#config/logger.js';

// ── Contact loaders ───────────────────────────────────────────────────────────

/**
 * Load FCM tokens and email for a user. Never throws.
 */
const loadUserContacts = async userId => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        email: true,
        devices: { where: { is_active: true }, select: { fcm_token: true } },
      },
    });
    if (!user) return { email: null, fcmTokens: [] };
    return {
      email: user.email ?? null,
      fcmTokens: user.devices?.map(d => d.fcm_token).filter(Boolean) ?? [],
    };
  } catch (err) {
    logger.error({ err: err.message, userId }, '[dispatcher] Failed to load user contacts');
    return { email: null, fcmTokens: [] };
  }
};

/**
 * Load FCM tokens for all active school admin devices. Never throws.
 */
const loadSchoolAdminFcmTokens = async schoolId => {
  try {
    const admins = await prisma.schoolAdmin.findMany({
      where: { school_id: schoolId, is_active: true },
      select: {
        user: { select: { devices: { where: { is_active: true }, select: { fcm_token: true } } } },
      },
    });
    return admins.flatMap(a => a.user?.devices?.map(d => d.fcm_token) ?? []).filter(Boolean);
  } catch (err) {
    logger.error({ err: err.message, schoolId }, '[dispatcher] Failed to load admin FCM tokens');
    return [];
  }
};

/**
 * Lazy school loader — single DB call per dispatch, reused across cases.
 * Returns null if schoolId missing or DB fails.
 */
const makeSchoolLoader = schoolId => {
  let _cached = undefined;
  return async () => {
    if (_cached !== undefined) return _cached;
    if (!schoolId) {
      _cached = null;
      return null;
    }
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
        user_id: meta?.userId ?? null,
        event_type: meta?.eventType ?? null,
      },
    });
  } catch (err) {
    logger.error({ err: err.message, channel }, '[dispatcher] Failed to write notification log');
  }
};

// ── Channel send helpers with timing + logging ────────────────────────────────

const timedSend = async (sendFn, channel, meta) => {
  const start = Date.now();
  const r = await sendFn();
  await writeNotificationLog({
    channel,
    status: r.success ? 'DELIVERED' : 'FAILED',
    latencyMs: Date.now() - start,
    providerRef: r.providerRef ?? null,
    error: r.error ?? null,
    meta,
  });
  return r;
};

/**
 * Fire all tasks in parallel, log each result, never throw.
 */
const sendParallel = async (tasks, meta) => {
  const results = await Promise.allSettled(tasks);
  for (const result of results) {
    if (result.status === 'rejected') {
      logger.error({ err: result.reason?.message, meta }, '[dispatcher] Channel task rejected');
    }
  }
  return results;
};

// ── Dispatcher ────────────────────────────────────────────────────────────────

/**
 * Dispatch notifications for a given event.
 * Called by notification.worker.js for every event pulled from the queue.
 *
 * @param {object} event — full stamped event from BullMQ job data
 * @returns {Promise<void>}
 */
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
      // ── EMERGENCY_ALERT_TRIGGERED → Push first, then SMS ──────────────────
      // Priority order per spec: Push → SMS. SMS fires regardless of push result.
      case EVENTS.EMERGENCY_ALERT_TRIGGERED: {
        const { studentName, schoolName, scannedAt, parentContacts, parentFcmTokens } = payload;
        const push = pushTemplates.EMERGENCY_ALERT({ studentName, schoolName });
        const smsBody = smsTemplates.EMERGENCY_ALERT({ studentName, schoolName, scannedAt });

        // 1. Push first
        await timedSend(
          () =>
            sendPushNotificationChannel({ tokens: parentFcmTokens ?? [], ...push, meta: logMeta }),
          'PUSH',
          logMeta
        );

        // 2. SMS to all parent contacts (parallel across contacts, sequential after push)
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

      // ── USER_OTP_REQUESTED → SMS only ──────────────────────────────────────
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

      // ── USER_DEVICE_LOGIN_NEW → email only ─────────────────────────────────
      case EVENTS.USER_DEVICE_LOGIN_NEW: {
        const { userId, name, device, location, time } = payload;
        const contacts = await loadUserContacts(userId);
        if (contacts.email) {
          const tmpl = emailTemplates.USER_DEVICE_LOGIN_NEW({ name, device, location, time });
          await timedSend(
            () => sendEmailNotification({ to: contacts.email, ...tmpl, meta: logMeta }),
            'EMAIL',
            logMeta
          );
        }
        break;
      }

      // ── ORDER_CONFIRMED → push + email ─────────────────────────────────────
      case EVENTS.ORDER_CONFIRMED: {
        const { orderNumber, cardCount, amount } = payload;
        const [tokens, school] = await Promise.all([
          loadSchoolAdminFcmTokens(schoolId),
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
                  () => sendEmailNotification({ to: school.email, ...tmpl, meta: logMeta }),
                  'EMAIL',
                  logMeta
                )
              : Promise.resolve(),
          ],
          logMeta
        );
        break;
      }

      // ── ORDER_ADVANCE_PAYMENT_RECEIVED → push + email ──────────────────────
      case EVENTS.ORDER_ADVANCE_PAYMENT_RECEIVED: {
        const { orderNumber, amount } = payload;
        const [tokens, school] = await Promise.all([
          loadSchoolAdminFcmTokens(schoolId),
          getSchool(),
        ]);
        const push = pushTemplates.ORDER_CONFIRMED({ orderNumber }); // reuse confirmed push
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
                  () => sendEmailNotification({ to: school.email, ...tmpl, meta: logMeta }),
                  'EMAIL',
                  logMeta
                )
              : Promise.resolve(),
          ],
          logMeta
        );
        break;
      }

      // ── ORDER_TOKEN_GENERATION_COMPLETE → push only ────────────────────────
      case EVENTS.ORDER_TOKEN_GENERATION_COMPLETE: {
        const { orderNumber } = payload;
        const tokens = await loadSchoolAdminFcmTokens(schoolId);
        const push = pushTemplates.ORDER_TOKEN_GENERATION_COMPLETE({ orderNumber });
        await timedSend(
          () => sendPushNotificationChannel({ tokens, ...push, meta: logMeta }),
          'PUSH',
          logMeta
        );
        break;
      }

      // ── ORDER_CARD_DESIGN_COMPLETE → push + email ──────────────────────────
      case EVENTS.ORDER_CARD_DESIGN_COMPLETE: {
        const { orderNumber, reviewUrl } = payload;
        const [tokens, school] = await Promise.all([
          loadSchoolAdminFcmTokens(schoolId),
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
                  () => sendEmailNotification({ to: school.email, ...tmpl, meta: logMeta }),
                  'EMAIL',
                  logMeta
                )
              : Promise.resolve(),
          ],
          logMeta
        );
        break;
      }

      // ── ORDER_SHIPPED → push + SMS + email ─────────────────────────────────
      case EVENTS.ORDER_SHIPPED: {
        const { orderNumber, trackingId, trackingUrl, schoolPhone } = payload;
        const [tokens, school] = await Promise.all([
          loadSchoolAdminFcmTokens(schoolId),
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
                  () => sendEmailNotification({ to: school.email, ...tmpl, meta: logMeta }),
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

      // ── ORDER_DELIVERED → push + email ─────────────────────────────────────
      case EVENTS.ORDER_DELIVERED: {
        const { orderNumber } = payload;
        const [tokens, school] = await Promise.all([
          loadSchoolAdminFcmTokens(schoolId),
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
                  () => sendEmailNotification({ to: school.email, ...tmpl, meta: logMeta }),
                  'EMAIL',
                  logMeta
                )
              : Promise.resolve(),
          ],
          logMeta
        );
        break;
      }

      // ── ORDER_BALANCE_INVOICE_ISSUED → push + email + SMS ──────────────────
      // WhatsApp stubbed — SMS used as fallback until MSG91 WhatsApp configured.
      case EVENTS.ORDER_BALANCE_INVOICE_ISSUED: {
        const { orderNumber, amount, dueDate, invoiceUrl, schoolPhone } = payload;
        const [tokens, school] = await Promise.all([
          loadSchoolAdminFcmTokens(schoolId),
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
                  () => sendEmailNotification({ to: school.email, ...tmpl, meta: logMeta }),
                  'EMAIL',
                  logMeta
                )
              : Promise.resolve(),
            // WhatsApp fallback → SMS until MSG91 WhatsApp is configured
            // To switch: replace sendSmsNotification with sendWhatsAppNotification here only
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

      // ── ORDER_COMPLETED → email ────────────────────────────────────────────
      case EVENTS.ORDER_COMPLETED: {
        const { orderNumber } = payload;
        const school = await getSchool();
        if (school?.email) {
          const tmpl = emailTemplates.ORDER_COMPLETED({ schoolName: school.name, orderNumber });
          await timedSend(
            () => sendEmailNotification({ to: school.email, ...tmpl, meta: logMeta }),
            'EMAIL',
            logMeta
          );
        }
        break;
      }

      // ── SCHOOL_ONBOARDED → email ───────────────────────────────────────────
      case EVENTS.SCHOOL_ONBOARDED: {
        const { schoolName, adminName, adminEmail, dashboardUrl } = payload;
        if (adminEmail) {
          const tmpl = emailTemplates.SCHOOL_ONBOARDED({ schoolName, adminName, dashboardUrl });
          await timedSend(
            () => sendEmailNotification({ to: adminEmail, ...tmpl, meta: logMeta }),
            'EMAIL',
            logMeta
          );
        }
        break;
      }

      // ── SCHOOL_RENEWAL_DUE → email + SMS ───────────────────────────────────
      // WhatsApp stubbed — SMS used as fallback until MSG91 WhatsApp configured.
      case EVENTS.SCHOOL_RENEWAL_DUE: {
        const { schoolName, adminEmail, schoolPhone, expiryDate, renewUrl } = payload;
        const tmpl = emailTemplates.SCHOOL_RENEWAL_DUE({ schoolName, expiryDate, renewUrl });
        const smsBody = smsTemplates.BALANCE_INVOICE_DUE
          ? `ResQID: ${schoolName} subscription expires on ${expiryDate}. Renew at: ${renewUrl ?? 'resqid.in/renew'}`
          : null;

        await sendParallel(
          [
            adminEmail
              ? timedSend(
                  () => sendEmailNotification({ to: adminEmail, ...tmpl, meta: logMeta }),
                  'EMAIL',
                  logMeta
                )
              : Promise.resolve(),
            // WhatsApp fallback → SMS until MSG91 WhatsApp is configured
            schoolPhone && smsBody
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
        const { studentName, expiryDate, daysLeft, parentPhone, parentFcmTokens } = payload;
        const push = pushTemplates.STUDENT_CARD_EXPIRING({ studentName, daysLeft });
        const smsBody = smsTemplates.STUDENT_CARD_EXPIRING({ studentName, expiryDate });

        await sendParallel(
          [
            timedSend(
              () =>
                sendPushNotificationChannel({
                  tokens: parentFcmTokens ?? [],
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

      // ── STUDENT_QR_SCANNED → push (if school setting enabled) ──────────────
      case EVENTS.STUDENT_QR_SCANNED: {
        const { studentName, location, parentFcmTokens, notifyEnabled } = payload;
        if (notifyEnabled && parentFcmTokens?.length) {
          const push = pushTemplates.STUDENT_QR_SCANNED({ studentName, location });
          await timedSend(
            () => sendPushNotificationChannel({ tokens: parentFcmTokens, ...push, meta: logMeta }),
            'PUSH',
            logMeta
          );
        }
        break;
      }

      // ── PARTIAL_PAYMENT_CONFIRMED → push + email ────────────────────────────────
      case EVENTS.PARTIAL_PAYMENT_CONFIRMED: {
        const { orderNumber, amount } = payload;
        const [tokens, school] = await Promise.all([
          loadSchoolAdminFcmTokens(schoolId),
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
                  () => sendEmailNotification({ to: school.email, ...tmpl, meta: logMeta }),
                  'EMAIL',
                  logMeta
                )
              : Promise.resolve(),
          ],
          logMeta
        );
        break;
      }

      // ── PARTIAL_INVOICE_GENERATED → push + email ────────────────────────────────
      case EVENTS.PARTIAL_INVOICE_GENERATED: {
        const { orderNumber, amount, invoiceUrl } = payload;
        const [tokens, school] = await Promise.all([
          loadSchoolAdminFcmTokens(schoolId),
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
                  () => sendEmailNotification({ to: school.email, ...tmpl, meta: logMeta }),
                  'EMAIL',
                  logMeta
                )
              : Promise.resolve(),
          ],
          logMeta
        );
        break;
      }

      // ── DESIGN_APPROVED → push + email ──────────────────────────────────────────
      case EVENTS.DESIGN_APPROVED: {
        const { orderNumber } = payload;
        const [tokens, school] = await Promise.all([
          loadSchoolAdminFcmTokens(schoolId),
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
                  () => sendEmailNotification({ to: school.email, ...tmpl, meta: logMeta }),
                  'EMAIL',
                  logMeta
                )
              : Promise.resolve(),
          ],
          logMeta
        );
        break;
      }

      // ── REFUNDED → email + optional push ────────────────────────────────────────
      case EVENTS.REFUNDED: {
        const { orderNumber, amount } = payload;
        const [tokens, school] = await Promise.all([
          loadSchoolAdminFcmTokens(schoolId),
          getSchool(),
        ]);
        const push = pushTemplates.REFUNDED({ orderNumber, amount });
        const tmpl = emailTemplates.REFUNDED({
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
                  () => sendEmailNotification({ to: school.email, ...tmpl, meta: logMeta }),
                  'EMAIL',
                  logMeta
                )
              : Promise.resolve(),
          ],
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
