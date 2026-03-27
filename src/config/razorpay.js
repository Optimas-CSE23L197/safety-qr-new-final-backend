// =============================================================================
// razorpay.js — RESQID
// Razorpay client for payments, subscriptions, and webhook verification
//
// Schema references:
//   Payment.provider_ref      — Razorpay payment ID (pay_xxx)
//   Payment.is_card_fee       — whether this is an initial card fee payment
//   Payment.is_renewal        — whether this is a subscription renewal
//   Subscription.provider     — "razorpay"
//   Subscription.provider_sub_id — Razorpay subscription ID (sub_xxx)
//   CardOrder.payment_id      — FK to Payment
//   Invoice.invoice_id        — Razorpay invoice ID (if used)
//   WebhookEvent.provider     — "razorpay"
//   WebhookEvent.event_type   — e.g. "payment.captured", "subscription.charged"
//
// Features:
//   - Razorpay Node.js SDK singleton
//   - Order creation for card fee payments
//   - Subscription creation for recurring school plans
//   - Webhook signature verification (HMAC-SHA256)
//   - Payment capture + refund helpers
//   - Dev mode: uses test credentials automatically
// =============================================================================

import Razorpay from 'razorpay';
import crypto from 'crypto';
import { ENV } from './env.js';
import { logger } from './logger.js';

// ─── Client Singleton ─────────────────────────────────────────────────────────

export const razorpay = new Razorpay({
  key_id: ENV.RAZORPAY_KEY_ID,
  key_secret: ENV.RAZORPAY_KEY_SECRET,
});

// ─── Order Creation ───────────────────────────────────────────────────────────

/**
 * createOrder(amount, options)
 * Create a Razorpay order for card fee or ad-hoc payment
 *
 * @param {number} amountPaise - Amount in paise (INR × 100). e.g. ₹99 = 9900
 * @param {object} options
 * @param {string} options.receipt      - Unique receipt ID (use CardOrder.id)
 * @param {object} [options.notes]      - Key-value metadata (visible in dashboard)
 * @returns {object} Razorpay order object { id, amount, currency, ... }
 */
export async function createOrder(amountPaise, options = {}) {
  const order = await razorpay.orders.create({
    amount: amountPaise,
    currency: 'INR',
    receipt: options.receipt,
    notes: options.notes ?? {},
    // Payment expiry — 30 minutes to complete payment
    payment_capture: 1, // auto-capture on success
  });

  logger.info(
    {
      type: 'razorpay_order_created',
      orderId: order.id,
      amount: amountPaise,
      receipt: options.receipt,
    },
    `Razorpay: order created ${order.id}`
  );

  return order;
}

// ─── Subscription Creation ────────────────────────────────────────────────────

/**
 * createSubscription(planId, options)
 * Create a Razorpay subscription for a school plan
 *
 * @param {string} planId     - Razorpay plan ID (created in dashboard)
 * @param {object} options
 * @param {number} options.totalCount    - Total billing cycles
 * @param {string} [options.customerId]  - Razorpay customer ID (cust_xxx)
 * @param {object} [options.notes]       - Key-value metadata
 * @returns {object} Razorpay subscription object { id, status, ... }
 *   Store id as Subscription.provider_sub_id
 */
export async function createSubscription(planId, options = {}) {
  const subscription = await razorpay.subscriptions.create({
    plan_id: planId,
    total_count: options.totalCount ?? 12,
    customer_id: options.customerId,
    notes: options.notes ?? {},
  });

  logger.info(
    {
      type: 'razorpay_subscription_created',
      subscriptionId: subscription.id,
      planId,
    },
    `Razorpay: subscription created ${subscription.id}`
  );

  return subscription;
}

// ─── Webhook Signature Verification ──────────────────────────────────────────

/**
 * verifyWebhookSignature(rawBody, signature)
 * Verify that a webhook request came from Razorpay
 * Must use the RAW request body (before JSON parsing)
 * Call this in the webhook handler BEFORE processing any event
 *
 * @param {string|Buffer} rawBody  - Raw request body
 * @param {string} signature       - X-Razorpay-Signature header value
 * @returns {boolean} true if signature is valid
 */
export function verifyWebhookSignature(rawBody, signature) {
  if (!signature) return false;

  const expectedSignature = crypto
    .createHmac('sha256', ENV.RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');

  // Constant-time comparison to prevent timing attacks
  try {
    const expected = Buffer.from(expectedSignature, 'hex');
    const received = Buffer.from(signature, 'hex');
    if (expected.length !== received.length) return false;
    return crypto.timingSafeEqual(expected, received);
  } catch {
    return false;
  }
}

// ─── Payment Verification ─────────────────────────────────────────────────────

/**
 * verifyPaymentSignature(orderId, paymentId, signature)
 * Verify Razorpay payment signature after client-side payment completion
 * Call this in the payment callback handler
 *
 * @param {string} orderId   - Razorpay order ID
 * @param {string} paymentId - Razorpay payment ID
 * @param {string} signature - razorpay_signature from client
 * @returns {boolean}
 */
export function verifyPaymentSignature(orderId, paymentId, signature) {
  const body = `${orderId}|${paymentId}`;
  const expectedSignature = crypto
    .createHmac('sha256', ENV.RAZORPAY_KEY_SECRET)
    .update(body)
    .digest('hex');

  try {
    const expected = Buffer.from(expectedSignature, 'hex');
    const received = Buffer.from(signature, 'hex');
    if (expected.length !== received.length) return false;
    return crypto.timingSafeEqual(expected, received);
  } catch {
    return false;
  }
}

// ─── Fetch Payment ────────────────────────────────────────────────────────────

/**
 * fetchPayment(paymentId)
 * Fetch a payment's current status from Razorpay
 * Use to verify payment.captured status before fulfilling orders
 */
export async function fetchPayment(paymentId) {
  return razorpay.payments.fetch(paymentId);
}

// ─── Refund ───────────────────────────────────────────────────────────────────

/**
 * createRefund(paymentId, amountPaise, notes)
 * Issue a full or partial refund
 *
 * @param {string} paymentId    - Razorpay payment ID
 * @param {number} [amountPaise] - Partial refund amount. Omit for full refund.
 * @param {object} [notes]       - Reason/metadata for refund
 * @returns {object} Razorpay refund object
 */
export async function createRefund(paymentId, amountPaise, notes = {}) {
  const refundOptions = {
    speed: 'normal',
    notes,
  };

  if (amountPaise) {
    refundOptions.amount = amountPaise;
  }

  const refund = await razorpay.payments.refund(paymentId, refundOptions);

  logger.info(
    {
      type: 'razorpay_refund_created',
      paymentId,
      refundId: refund.id,
      amount: amountPaise ?? 'full',
    },
    `Razorpay: refund created ${refund.id}`
  );

  return refund;
}

// ─── Subscription Cancel ──────────────────────────────────────────────────────

/**
 * cancelSubscription(subscriptionId, cancelAtCycleEnd)
 * Cancel a subscription
 *
 * @param {string} subscriptionId  - Razorpay subscription ID
 * @param {boolean} cancelAtCycleEnd - If true, cancel at end of current cycle
 */
export async function cancelSubscription(subscriptionId, cancelAtCycleEnd = true) {
  const result = await razorpay.subscriptions.cancel(subscriptionId, cancelAtCycleEnd);

  logger.info(
    {
      type: 'razorpay_subscription_cancelled',
      subscriptionId,
      cancelAtCycleEnd,
    },
    `Razorpay: subscription cancelled ${subscriptionId}`
  );

  return result;
}
