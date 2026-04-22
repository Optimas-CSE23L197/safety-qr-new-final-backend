// =============================================================================
// orchestrator/notifications/notification.publisher.js — RESQID
//
// Single entry point for all application code that triggers a notification.
// Typed facade over event.publisher.publish().
//
// FIXES:
//   - parentFcmTokens renamed to parentExpoTokens everywhere.
//   - studentQrScanned uses parentExpoTokens (not fcmTokens).
// =============================================================================

import { publish } from '../events/event.publisher.js';
import { EVENTS } from '../events/event.types.js';

const _publish = (
  type,
  { schoolId = null, actorId, actorType = 'SYSTEM', payload = {}, meta = {} }
) => publish({ type, schoolId, actorId, actorType, payload, meta });

export const publishNotification = {
  // ── Emergency ──────────────────────────────────────────────────────────────

  emergencyAlertTriggered: ({ schoolId, actorId, actorType = 'SYSTEM', payload, meta = {} }) =>
    _publish(EVENTS.EMERGENCY_ALERT_TRIGGERED, {
      schoolId,
      actorId,
      actorType,
      payload: {
        studentName: payload.studentName,
        schoolName: payload.schoolName,
        scannedAt: payload.scannedAt,
        parentContacts: payload.parentContacts, // string[] — phone numbers
        parentExpoTokens: payload.parentExpoTokens ?? [], // string[] — Expo tokens
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

  otpRequested: ({ actorId, payload, meta = {} }) =>
    _publish(EVENTS.USER_OTP_REQUESTED, {
      actorId,
      actorType: 'USER',
      payload: {
        phone: payload.phone,
        otp: payload.otp,
        namespace: payload.namespace,
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
        orderNumber: payload.orderNumber,
        cardCount: payload.cardCount,
        amount: payload.amount,
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
        schoolPhone: payload.schoolPhone ?? null,
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
        parentExpoTokens: payload.parentExpoTokens ?? [], // Expo tokens
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
        parentExpoTokens: payload.parentExpoTokens ?? [], // Expo tokens
        notifyEnabled: payload.notifyEnabled ?? true,
      },
      meta: { studentId: meta.studentId, ...meta },
    }),

  newDeviceLogin: ({ userId, userType, payload, meta = {} }) =>
    _publish(EVENTS.USER_DEVICE_LOGIN_NEW, {
      actorId: userId,
      actorType: userType,
      payload: {
        userId,
        userType,
        name: payload.name,
        device: payload.device,
        location: payload.location,
        time: payload.time,
      },
      meta,
    }),
};
