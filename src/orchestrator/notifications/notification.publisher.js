// =============================================================================
// orchestrator/notifications/notification.publisher.js — RESQID
//
// Global notification publisher. The single entry point for all application
// code that needs to trigger a notification.
//
// WHAT THIS IS:
//   A typed facade over event.publisher.publish(). Services never import
//   event.publisher directly — they import publishNotification() here.
//   This keeps event shape construction in one place.
//
// WHAT THIS IS NOT:
//   - A channel sender (SMS/push/email). Those live in channel/*.js.
//   - A dispatcher. That lives in notification.dispatcher.js.
//   - A queue. Routing happens inside event.publisher.js.
//
// USAGE (from any service or worker):
//   import { publishNotification } from
//     '#orchestrator/notifications/notification.publisher.js';
//
//   await publishNotification.orderConfirmed({
//     schoolId, actorId: userId,
//     payload: { orderNumber, cardCount, amount },
//     meta: { orderId },
//   });
//
// ADDING A NEW NOTIFICATION:
//   1. Add event type to event.types.js
//   2. Add a case to notification.dispatcher.js
//   3. Add a template to notification.templates.js  (if needed)
//   4. Add a publisher method here
//   Zero other changes.
// =============================================================================

import { publish } from '../events/event.publisher.js';
import { EVENTS } from '../events/event.types.js';

// ── Internal builder ──────────────────────────────────────────────────────────
// Wraps publish() with a consistent actor/shape, so callers only pass
// what's semantically meaningful to them.

const _publish = (
  type,
  { schoolId = null, actorId, actorType = 'SYSTEM', payload = {}, meta = {} }
) => publish({ type, schoolId, actorId, actorType, payload, meta });

// ── Publisher methods ─────────────────────────────────────────────────────────
// One method per event type that triggers a notification.
// Named after the domain action, not the event constant.

export const publishNotification = {
  // ── Emergency ──────────────────────────────────────────────────────────────

  /**
   * QR card scanned in emergency mode.
   * Routes to emergencyAlertsQueue (priority 1, isolated resources).
   * Payload must include parentFcmTokens + parentContacts — resolved by caller.
   */
  emergencyAlertTriggered: ({ schoolId, actorId, actorType = 'SYSTEM', payload, meta = {} }) =>
    _publish(EVENTS.EMERGENCY_ALERT_TRIGGERED, {
      schoolId,
      actorId,
      actorType,
      payload: {
        studentName: payload.studentName, // string
        schoolName: payload.schoolName, // string
        scannedAt: payload.scannedAt, // ISO string
        parentContacts: payload.parentContacts, // string[]  — phone numbers
        parentFcmTokens: payload.parentFcmTokens ?? [], // string[]
      },
      meta: { alertId: meta.alertId, studentId: meta.studentId, ...meta },
    }),

  emergencyAlertEscalated: ({ schoolId, actorId, payload, meta = {} }) =>
    _publish(EVENTS.EMERGENCY_ALERT_ESCALATED, {
      schoolId,
      actorId,
      actorType: 'SYSTEM',
      payload,
      meta,
    }),

  // ── OTP ────────────────────────────────────────────────────────────────────

  /**
   * OTP events are published here for audit/logging purposes but
   * the SMS is sent INLINE by the auth service — never queued.
   * The dispatcher has a case for USER_OTP_REQUESTED that handles the SMS
   * if it does reach the queue (e.g., retry scenarios).
   */
  otpRequested: ({ actorId, payload, meta = {} }) =>
    _publish(EVENTS.USER_OTP_REQUESTED, {
      actorId,
      actorType: 'USER',
      payload: {
        phone: payload.phone, // string
        otp: payload.otp, // string
        namespace: payload.namespace, // 'login' | 'register'
        expiryMinutes: payload.expiryMinutes ?? 5,
      },
      meta,
    }),

  // ── Order lifecycle ────────────────────────────────────────────────────────

  orderConfirmed: ({ schoolId, actorId, payload, meta = {} }) =>
    _publish(EVENTS.ORDER_CONFIRMED, {
      schoolId,
      actorId,
      actorType: 'USER',
      payload: {
        orderNumber: payload.orderNumber, // string
        cardCount: payload.cardCount, // number
        amount: payload.amount, // number
      },
      meta: { orderId: meta.orderId, ...meta },
    }),

  advancePaymentReceived: ({ schoolId, actorId, payload, meta = {} }) =>
    _publish(EVENTS.ORDER_ADVANCE_PAYMENT_RECEIVED, {
      schoolId,
      actorId,
      actorType: 'SYSTEM',
      payload: {
        orderNumber: payload.orderNumber,
        amount: payload.amount,
      },
      meta: { orderId: meta.orderId, ...meta },
    }),

  partialPaymentConfirmed: ({ schoolId, actorId, payload, meta = {} }) =>
    _publish(EVENTS.PARTIAL_PAYMENT_CONFIRMED, {
      schoolId,
      actorId,
      actorType: 'SYSTEM',
      payload: {
        orderNumber: payload.orderNumber,
        amount: payload.amount,
      },
      meta: { orderId: meta.orderId, ...meta },
    }),

  partialInvoiceGenerated: ({ schoolId, actorId, payload, meta = {} }) =>
    _publish(EVENTS.PARTIAL_INVOICE_GENERATED, {
      schoolId,
      actorId,
      actorType: 'WORKER',
      payload: {
        orderNumber: payload.orderNumber,
        amount: payload.amount,
        invoiceUrl: payload.invoiceUrl ?? null,
      },
      meta: { orderId: meta.orderId, ...meta },
    }),

  tokenGenerationComplete: ({ schoolId, actorId, payload, meta = {} }) =>
    _publish(EVENTS.ORDER_TOKEN_GENERATION_COMPLETE, {
      schoolId,
      actorId,
      actorType: 'WORKER',
      payload: { orderNumber: payload.orderNumber },
      meta: { orderId: meta.orderId, ...meta },
    }),

  cardDesignComplete: ({ schoolId, actorId, payload, meta = {} }) =>
    _publish(EVENTS.ORDER_CARD_DESIGN_COMPLETE, {
      schoolId,
      actorId,
      actorType: 'WORKER',
      payload: {
        orderNumber: payload.orderNumber,
        reviewUrl: payload.reviewUrl ?? null,
      },
      meta: { orderId: meta.orderId, ...meta },
    }),

  designApproved: ({ schoolId, actorId, payload, meta = {} }) =>
    _publish(EVENTS.DESIGN_APPROVED, {
      schoolId,
      actorId,
      actorType: 'USER',
      payload: { orderNumber: payload.orderNumber },
      meta: { orderId: meta.orderId, ...meta },
    }),

  orderShipped: ({ schoolId, actorId, payload, meta = {} }) =>
    _publish(EVENTS.ORDER_SHIPPED, {
      schoolId,
      actorId,
      actorType: 'SYSTEM',
      payload: {
        orderNumber: payload.orderNumber,
        trackingId: payload.trackingId,
        trackingUrl: payload.trackingUrl ?? null,
        schoolPhone: payload.schoolPhone ?? null, // for SMS
      },
      meta: { orderId: meta.orderId, ...meta },
    }),

  orderDelivered: ({ schoolId, actorId, payload, meta = {} }) =>
    _publish(EVENTS.ORDER_DELIVERED, {
      schoolId,
      actorId,
      actorType: 'SYSTEM',
      payload: { orderNumber: payload.orderNumber },
      meta: { orderId: meta.orderId, ...meta },
    }),

  balanceInvoiceIssued: ({ schoolId, actorId, payload, meta = {} }) =>
    _publish(EVENTS.ORDER_BALANCE_INVOICE_ISSUED, {
      schoolId,
      actorId,
      actorType: 'WORKER',
      payload: {
        orderNumber: payload.orderNumber,
        amount: payload.amount,
        dueDate: payload.dueDate,
        invoiceUrl: payload.invoiceUrl ?? null,
        schoolPhone: payload.schoolPhone ?? null,
      },
      meta: { orderId: meta.orderId, ...meta },
    }),

  orderCompleted: ({ schoolId, actorId, payload, meta = {} }) =>
    _publish(EVENTS.ORDER_COMPLETED, {
      schoolId,
      actorId,
      actorType: 'SYSTEM',
      payload: { orderNumber: payload.orderNumber },
      meta: { orderId: meta.orderId, ...meta },
    }),

  orderRefunded: ({ schoolId, actorId, payload, meta = {} }) =>
    _publish(EVENTS.ORDER_REFUNDED, {
      schoolId,
      actorId,
      actorType: 'SYSTEM',
      payload: {
        orderNumber: payload.orderNumber,
        amount: payload.amount,
      },
      meta: { orderId: meta.orderId, ...meta },
    }),

  // ── School ─────────────────────────────────────────────────────────────────

  schoolOnboarded: ({ schoolId, actorId, payload, meta = {} }) =>
    _publish(EVENTS.SCHOOL_ONBOARDED, {
      schoolId,
      actorId,
      actorType: 'SYSTEM',
      payload: {
        schoolName: payload.schoolName,
        adminName: payload.adminName,
        adminEmail: payload.adminEmail,
        dashboardUrl: payload.dashboardUrl ?? null,
      },
      meta,
    }),

  schoolRenewalDue: ({ schoolId, actorId, payload, meta = {} }) =>
    _publish(EVENTS.SCHOOL_RENEWAL_DUE, {
      schoolId,
      actorId,
      actorType: 'SYSTEM',
      payload: {
        schoolName: payload.schoolName,
        adminEmail: payload.adminEmail,
        schoolPhone: payload.schoolPhone ?? null,
        expiryDate: payload.expiryDate,
        renewUrl: payload.renewUrl ?? null,
      },
      meta,
    }),

  // ── Student ────────────────────────────────────────────────────────────────

  studentCardExpiring: ({ schoolId, actorId, payload, meta = {} }) =>
    _publish(EVENTS.STUDENT_CARD_EXPIRING, {
      schoolId,
      actorId,
      actorType: 'SYSTEM',
      payload: {
        studentName: payload.studentName,
        expiryDate: payload.expiryDate,
        daysLeft: payload.daysLeft,
        parentPhone: payload.parentPhone ?? null,
        parentFcmTokens: payload.parentFcmTokens ?? [],
      },
      meta: { studentId: meta.studentId, ...meta },
    }),

  studentQrScanned: ({ schoolId, actorId, payload, meta = {} }) =>
    _publish(EVENTS.STUDENT_QR_SCANNED, {
      schoolId,
      actorId,
      actorType: 'SYSTEM',
      payload: {
        studentName: payload.studentName,
        location: payload.location ?? null,
        parentFcmTokens: payload.parentFcmTokens ?? [],
        notifyEnabled: payload.notifyEnabled ?? true,
      },
      meta: { studentId: meta.studentId, ...meta },
    }),
};
