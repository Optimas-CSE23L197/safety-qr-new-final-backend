// =============================================================================
// modules/notification/notification.module.service.js — RESQID
//
// Single source of truth for ALL notification triggers across the app.
// Import this file anywhere — never import publishNotification directly.
//
// Pattern: each function fetches its own data from repo, assembles payload,
// and publishes to BullMQ via publishNotification. Caller passes only an ID.
// =============================================================================

import { publishNotification } from '#orchestrator/notifications/notification.publisher.js';
import { logger } from '#config/logger.js';
import { NOTIFICATION_DELAYS, APP_URLS, OTP_CONFIG } from './notification.constants.js';
import * as repo from './notification.repository.js';
import {
  formatAmount,
  formatDate,
  daysUntil,
  extractExpoTokens,
  safePublish,
} from './notification.utils.js';

// =============================================================================
// OTP
// =============================================================================

/**
 * Send OTP via SMS (auth flows — login, register, phone change)
 * Called from: auth.service.js, parent.service.js
 */
export async function sendOtp({
  phone,
  otp,
  namespace = OTP_CONFIG.NAMESPACES.LOGIN,
  expiryMinutes = OTP_CONFIG.DEFAULT_EXPIRY_MINUTES,
}) {
  return safePublish(
    () =>
      publishNotification.otpRequested({
        actorId: phone,
        payload: { phone, otp, namespace, expiryMinutes },
      }),
    'sendOtp'
  );
}

// =============================================================================
// AUTH / SECURITY
// =============================================================================

/**
 * Send new device login alert email
 * Called from: auth.service.js (parent + school login)
 */
export async function sendNewDeviceAlert(userId, userType, { device, location }) {
  const contact =
    userType === 'PARENT'
      ? await repo.getParentContactInfo(userId)
      : await repo.getSchoolUserNotificationData(userId);

  return safePublish(
    () =>
      publishNotification.newDeviceLogin({
        userId,
        userType,
        payload: {
          name: contact?.name ?? null,
          device,
          location,
          time: new Date().toLocaleString('en-IN'),
        },
      }),
    'sendNewDeviceAlert'
  );
}

// =============================================================================
// PARENT
// =============================================================================

/**
 * Send welcome email to parent after email verification
 * Called from: parent.service.js → verifyEmail()
 * Delayed 2 minutes via BullMQ — feels personal, not instant-bot
 */
export async function sendParentWelcome(parentId) {
  const data = await repo.getParentNotificationData(parentId);
  if (!data?.email) return; // no email, skip silently

  const studentLink = data.studentLinks?.[0];
  const student = studentLink?.student;
  const cardId = student?.tokens?.[0]?.cards?.[0]?.card_number ?? student?.card_number ?? null;

  return safePublish(
    () =>
      publishNotification.parentEmailVerified({
        actorId: parentId,
        payload: {
          parentName: data.name ?? 'Parent',
          parentEmail: data.email,
          studentName: student?.first_name ?? '',
          studentClass: student?.class ?? '',
          schoolName: student?.school?.name ?? '',
          cardId,
          playStoreUrl: APP_URLS.PLAY_STORE,
          appStoreUrl: APP_URLS.APP_STORE,
        },
        meta: { delay: NOTIFICATION_DELAYS.WELCOME_EMAIL },
      }),
    'sendParentWelcome'
  );
}

// =============================================================================
// SCHOOL
// =============================================================================

/**
 * Send welcome email to school admin after school is created
 * Called from: school.service.js → createSchool()
 */
export async function sendSchoolWelcome(schoolUserId, { tempPassword }) {
  const data = await repo.getSchoolUserNotificationData(schoolUserId);
  if (!data?.email) return;

  const sub = data.school?.subscription;

  return safePublish(
    () =>
      publishNotification.schoolUserOnboarded({
        schoolId: data.school?.id,
        actorId: schoolUserId,
        payload: {
          schoolName: data.school?.name ?? '',
          adminName: data.name ?? '',
          adminEmail: data.email,
          tempPassword,
          dashboardUrl: APP_URLS.DASHBOARD,
          planName: sub?.plan ?? null,
          planExpiry: formatDate(sub?.current_period_end),
          cardCount: sub?.student_count ?? null,
        },
        meta: { delay: NOTIFICATION_DELAYS.WELCOME_EMAIL },
      }),
    'sendSchoolWelcome'
  );
}

/**
 * Send school subscription renewal reminder
 * Called from: maintenance.worker.js
 */
export async function sendSchoolRenewalDue(schoolId) {
  const data = await repo.getSchoolNotificationData(schoolId);
  if (!data) return;

  const adminEmail = data.email ?? data.users?.[0]?.email;
  if (!adminEmail) return;

  const expiryDate = formatDate(data.subscription?.current_period_end);
  const renewUrl = APP_URLS.RENEW;

  return safePublish(
    () =>
      publishNotification.schoolRenewalDue({
        schoolId,
        actorId: schoolId,
        payload: {
          schoolName: data.name,
          adminEmail,
          schoolPhone: data.phone ?? null,
          expiryDate,
          renewUrl,
        },
      }),
    'sendSchoolRenewalDue'
  );
}

// =============================================================================
// EMERGENCY
// =============================================================================

/**
 * Send emergency alert push + SMS to all linked parents
 * Called from: emergency.worker.js / scan.service.js
 */
export async function sendEmergencyAlert(studentId, { scannedAt, location }) {
  const data = await repo.getStudentNotificationData(studentId);
  if (!data) return;

  const parent = data.parentLinks?.[0]?.parent;
  const parentContacts = parent?.phone ? [parent.phone] : [];
  const parentExpoTokens = extractExpoTokens(parent?.devices);
  const parentEmail = parent?.email ?? null;

  return safePublish(
    () =>
      publishNotification.emergencyAlertTriggered({
        schoolId: data.school?.id,
        actorId: studentId,
        actorType: 'SYSTEM',
        payload: {
          studentName: data.first_name,
          schoolName: data.school?.name ?? '',
          scannedAt,
          location: location ?? null,
          parentContacts,
          parentExpoTokens,
          parentEmail, // ← ADD
        },
        meta: { studentId },
      }),
    'sendEmergencyAlert'
  );
}

// =============================================================================
// STUDENT
// =============================================================================

/**
 * Send card expiry warning push + SMS to parents
 * Called from: maintenance.worker.js
 */
export async function sendCardExpiryWarning(studentId) {
  const data = await repo.getStudentNotificationData(studentId);
  if (!data) return;

  const token = data.tokens?.[0];
  if (!token?.expires_at) return;

  const expiryDate = formatDate(token.expires_at);
  const daysLeft = daysUntil(token.expires_at);
  // Single parent, push-only to registered devices
  const parent = data.parentLinks?.[0]?.parent;
  const parentExpoTokens = extractExpoTokens(parent?.devices);

  return safePublish(
    () =>
      publishNotification.studentCardExpiring({
        schoolId: data.school?.id,
        actorId: studentId,
        payload: {
          studentName: data.first_name,
          expiryDate,
          daysLeft,
          parentExpoTokens,
        },
        meta: { studentId },
      }),
    'sendCardExpiryWarning'
  );
}

// =============================================================================
// ORDER LIFECYCLE
// =============================================================================

/**
 * Order confirmed + advance payment received
 * Called from: order.service.js → confirmOrder()
 */
export async function sendOrderConfirmed(orderId) {
  const data = await repo.getOrderNotificationData(orderId);
  if (!data) return;

  return safePublish(
    () =>
      publishNotification.orderConfirmed({
        schoolId: data.school_id,
        actorId: data.school_id,
        payload: {
          orderNumber: data.order_number,
          cardCount: data.student_count,
          amount: formatAmount(data.advance_amount),
        },
        meta: { orderId },
      }),
    'sendOrderConfirmed'
  );
}

/**
 * Called from: order.service.js → recordAdvancePayment()
 */
export async function sendAdvancePaymentReceived(orderId) {
  const data = await repo.getOrderNotificationData(orderId);
  if (!data) return;

  return safePublish(
    () =>
      publishNotification.advancePaymentReceived({
        schoolId: data.school_id,
        actorId: data.school_id,
        payload: {
          orderNumber: data.order_number,
          amount: formatAmount(data.advance_amount),
        },
        meta: { orderId },
      }),
    'sendAdvancePaymentReceived'
  );
}

/**
 * Called from: order.service.js → recordPartialPayment()
 */
export async function sendPartialPaymentConfirmed(orderId) {
  const data = await repo.getOrderNotificationData(orderId);
  if (!data) return;

  return safePublish(
    () =>
      publishNotification.partialPaymentConfirmed({
        schoolId: data.school_id,
        actorId: data.school_id,
        payload: {
          orderNumber: data.order_number,
          amount: formatAmount(data.partialInvoice?.total_amount),
        },
        meta: { orderId },
      }),
    'sendPartialPaymentConfirmed'
  );
}

/**
 * Called from: invoice.worker.js → generatePartialInvoice()
 */
export async function sendPartialInvoiceGenerated(orderId) {
  const data = await repo.getOrderNotificationData(orderId);
  if (!data) return;

  return safePublish(
    () =>
      publishNotification.partialInvoiceGenerated({
        schoolId: data.school_id,
        actorId: data.school_id,
        payload: {
          orderNumber: data.order_number,
          amount: formatAmount(data.partialInvoice?.total_amount),
          invoiceUrl: null, // attach when invoice PDF URL is available
        },
        meta: { orderId },
      }),
    'sendPartialInvoiceGenerated'
  );
}

/**
 * Called from: pipeline.worker.js → after token generation complete
 */
export async function sendTokenGenerationComplete(orderId) {
  const data = await repo.getOrderNotificationData(orderId);
  if (!data) return;

  return safePublish(
    () =>
      publishNotification.tokenGenerationComplete({
        schoolId: data.school_id,
        actorId: data.school_id,
        payload: { orderNumber: data.order_number },
        meta: { orderId },
      }),
    'sendTokenGenerationComplete'
  );
}

/**
 * Called from: design.worker.js → after card design PDF generated
 */
export async function sendCardDesignComplete(orderId) {
  const data = await repo.getOrderNotificationData(orderId);
  if (!data) return;

  return safePublish(
    () =>
      publishNotification.cardDesignComplete({
        schoolId: data.school_id,
        actorId: data.school_id,
        payload: {
          orderNumber: data.order_number,
          reviewUrl: `${APP_URLS.DASHBOARD}/orders/${orderId}/review`,
        },
        meta: { orderId },
      }),
    'sendCardDesignComplete'
  );
}

/**
 * Called from: order.service.js → approveDesign()
 */
export async function sendDesignApproved(orderId) {
  const data = await repo.getOrderNotificationData(orderId);
  if (!data) return;

  return safePublish(
    () =>
      publishNotification.designApproved({
        schoolId: data.school_id,
        actorId: data.school_id,
        payload: { orderNumber: data.order_number },
        meta: { orderId },
      }),
    'sendDesignApproved'
  );
}

/**
 * Called from: order.service.js → markShipped()
 */
export async function sendOrderShipped(orderId) {
  const data = await repo.getOrderNotificationData(orderId);
  if (!data) return;

  return safePublish(
    () =>
      publishNotification.orderShipped({
        schoolId: data.school_id,
        actorId: data.school_id,
        payload: {
          orderNumber: data.order_number,
          trackingId: data.shipment?.tracking_id ?? null,
          trackingUrl: data.shipment?.tracking_url ?? null,
          schoolPhone: data.school?.phone ?? null,
        },
        meta: { orderId },
      }),
    'sendOrderShipped'
  );
}

/**
 * Called from: order.service.js → markDelivered()
 */
export async function sendOrderDelivered(orderId) {
  const data = await repo.getOrderNotificationData(orderId);
  if (!data) return;

  return safePublish(
    () =>
      publishNotification.orderDelivered({
        schoolId: data.school_id,
        actorId: data.school_id,
        payload: { orderNumber: data.order_number },
        meta: { orderId },
      }),
    'sendOrderDelivered'
  );
}

/**
 * Called from: invoice.worker.js → generateBalanceInvoice()
 */
export async function sendBalanceInvoiceIssued(orderId) {
  const data = await repo.getOrderNotificationData(orderId);
  if (!data) return;

  return safePublish(
    () =>
      publishNotification.balanceInvoiceIssued({
        schoolId: data.school_id,
        actorId: data.school_id,
        payload: {
          orderNumber: data.order_number,
          amount: formatAmount(data.finalInvoice?.total_amount),
          dueDate: null, // set when due date logic is added
          invoiceUrl: null, // attach when invoice PDF URL is available
          schoolPhone: data.school?.phone ?? null,
        },
        meta: { orderId },
      }),
    'sendBalanceInvoiceIssued'
  );
}

/**
 * Called from: order.service.js → completeOrder()
 */
export async function sendOrderCompleted(orderId) {
  const data = await repo.getOrderNotificationData(orderId);
  if (!data) return;

  return safePublish(
    () =>
      publishNotification.orderCompleted({
        schoolId: data.school_id,
        actorId: data.school_id,
        payload: { orderNumber: data.order_number },
        meta: { orderId },
      }),
    'sendOrderCompleted'
  );
}

/**
 * Called from: order.service.js → refundOrder()
 */
export async function sendOrderRefunded(orderId) {
  const data = await repo.getOrderNotificationData(orderId);
  if (!data) return;

  return safePublish(
    () =>
      publishNotification.orderRefunded({
        schoolId: data.school_id,
        actorId: data.school_id,
        payload: {
          orderNumber: data.order_number,
          amount: formatAmount(data.grand_total),
        },
        meta: { orderId },
      }),
    'sendOrderRefunded'
  );
}
