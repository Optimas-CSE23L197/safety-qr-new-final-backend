// =============================================================================
// events/event.consumer.js
// Bridges events to the orchestrator and handles webhook callbacks.
// Called from controllers and webhook handlers.
// =============================================================================

import { logger } from '#config/logger.js';
import { publishEvent, publishNotification, publishFailure } from './event.publisher.js';
import { ORDER_EVENTS } from './event.types.js';
import { transitionState, getOrderState } from '#services/state.service.js';
import { claimExecution, markCompleted } from '#services/idempotency.service.js';
import { stepLog } from '#utils/step.logger.js';
import { prisma } from '#config/prisma.js';

/**
 * Handle incoming webhook event (Razorpay, Shiprocket, etc.)
 */
export async function handleWebhookEvent(provider, eventType, payload, idempotencyKey) {
  logger.info({
    msg: 'Processing webhook event',
    provider,
    eventType,
    idempotencyKey,
  });

  const { claimed } = await claimExecution(
    idempotencyKey,
    `webhook_${provider}_${eventType}`,
    86400
  );

  if (!claimed) {
    logger.info({
      msg: 'Webhook already processed, skipping',
      provider,
      eventType,
      idempotencyKey,
    });
    return { skipped: true, reason: 'Already processed' };
  }

  try {
    let result;

    switch (provider) {
      case 'razorpay':
        result = await handleRazorpayWebhook(eventType, payload);
        break;
      case 'shiprocket':
        result = await handleShiprocketWebhook(eventType, payload);
        break;
      default:
        throw new Error(`Unknown provider: ${provider}`);
    }

    await markCompleted(idempotencyKey, `webhook_${provider}_${eventType}`, result);
    return result;
  } catch (error) {
    logger.error({
      msg: 'Webhook processing failed',
      provider,
      eventType,
      error: error.message,
    });
    throw error;
  }
}

async function handleRazorpayWebhook(eventType, payload) {
  const orderId = payload.notes?.orderId;
  if (!orderId) {
    throw new Error('No orderId in webhook payload');
  }

  const payment = payload.payment;

  switch (eventType) {
    case 'payment.captured':
      // Advance payment received
      return await publishEvent(ORDER_EVENTS.ADVANCE_PAYMENT_RECEIVED, orderId, {
        paymentId: payment.id,
        amount: payment.amount,
        reference: payment.id,
        provider: 'razorpay',
        providerRef: payment.id,
      });

    case 'payment.failed':
      // Payment failed - notify super admin
      await publishFailure(
        orderId,
        'ADVANCE_PAYMENT',
        new Error(payment.error_description || 'Payment failed'),
        {
          paymentId: payment.id,
          amount: payment.amount,
        }
      );
      return { handled: true, event: 'payment.failed' };

    default:
      logger.info({ msg: 'Unhandled Razorpay event', eventType });
      return { handled: false, eventType };
  }
}

async function handleShiprocketWebhook(eventType, payload) {
  const orderId = payload.order_id;
  if (!orderId) {
    throw new Error('No order_id in webhook payload');
  }

  const shipment = await prisma.orderShipment.findFirst({
    where: { order_id: orderId },
  });

  if (!shipment) {
    throw new Error(`Shipment not found for order ${orderId}`);
  }

  // Update shipment status
  await prisma.orderShipment.update({
    where: { id: shipment.id },
    data: {
      shiprocket_status: eventType.toUpperCase(),
      status: mapShiprocketStatus(eventType),
      ...(eventType === 'delivered' && { delivered_at: new Date() }),
    },
  });

  // If delivered, trigger delivery event
  if (eventType === 'delivered') {
    return await publishEvent(ORDER_EVENTS.DELIVERED, orderId, {
      shipmentId: shipment.id,
      deliveredAt: new Date().toISOString(),
      awbCode: shipment.awb_code,
    });
  }

  return { handled: true, eventType, shipmentId: shipment.id };
}

function mapShiprocketStatus(eventType) {
  const statusMap = {
    pickup_scheduled: 'PICKUP_SCHEDULED',
    picked_up: 'PICKED_UP',
    in_transit: 'IN_TRANSIT',
    out_for_delivery: 'OUT_FOR_DELIVERY',
    delivered: 'DELIVERED',
    failed: 'FAILED',
    rto_initiated: 'RTO_INITIATED',
    rto_delivered: 'RTO_DELIVERED',
  };
  return statusMap[eventType] || 'IN_TRANSIT';
}

/**
 * Manual step advancement (super admin override)
 */
export async function advanceStepManually(orderId, step, actorId, notes, metadata = {}) {
  logger.info({ msg: 'Manual step advancement', orderId, step, actorId });

  const currentState = await getOrderState(orderId);

  // Map step to event
  const stepToEvent = {
    CONFIRM: ORDER_EVENTS.ORDER_APPROVED,
    ADVANCE_PAYMENT: ORDER_EVENTS.ADVANCE_PAYMENT_RECEIVED,
    TOKEN_GENERATION: ORDER_EVENTS.TOKEN_GENERATED,
    CARD_DESIGN: ORDER_EVENTS.CARD_GENERATED,
    VENDOR_DISPATCH: ORDER_EVENTS.DESIGN_COMPLETED,
    PRINTING_START: ORDER_EVENTS.PRINTING_STARTED,
    SHIPMENT: ORDER_EVENTS.SHIPPED,
    DELIVERY: ORDER_EVENTS.DELIVERED,
    BALANCE_PAYMENT: ORDER_EVENTS.ORDER_COMPLETED,
  };

  const event = stepToEvent[step];
  if (!event) {
    throw new Error(`No event mapping for step: ${step}`);
  }

  // Get pipeline and step execution
  const pipeline = await prisma.orderPipeline.findFirst({
    where: { order_id: orderId },
  });

  if (!pipeline) {
    throw new Error(`Pipeline not found for order ${orderId}`);
  }

  const stepExecution = await prisma.orderStepExecution.create({
    data: {
      pipeline_id: pipeline.id,
      order_id: orderId,
      step: step,
      attempt_number: 1,
      status: 'COMPLETED',
      started_at: new Date(),
      completed_at: new Date(),
      triggered_by: actorId,
      result_summary: { manual: true, notes, metadata },
    },
  });

  await stepLog(
    stepExecution.id,
    orderId,
    `Manual step advancement: ${step}`,
    { notes, metadata },
    null
  );

  // Publish the event
  return await publishEvent(event, orderId, {
    manual: true,
    triggeredBy: actorId,
    notes,
    metadata,
  });
}
