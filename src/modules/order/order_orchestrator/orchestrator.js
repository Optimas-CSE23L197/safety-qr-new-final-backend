// =============================================================================
// orchestrator.js — Main orchestrator entry point
// Exposed functions called from controllers and webhooks.
// =============================================================================

import { logger } from '#config/logger.js';
import { redis } from '#config/database/redis.js';
import { prisma } from '#config/database/prisma.js';
import { QUEUE_NAMES, JOB_NAMES } from './orchestrator.constants.js';
import { getQueue } from './queues/queue.manager.js';
import { claimExecution, acquireLock, releaseLock } from './services/idempotency.service.js';
import { transitionState, getOrderState } from './services/state.service.js';
import { publishEvent, publishNotification } from './events/event.publisher.js';
import { ORDER_EVENTS } from './events/event.types.js';
import { evaluateCancellation } from './policies/cancellation.policy.js';
import { guardSchoolAdmin, guardSuperAdmin, guardOrderExists } from './state/order.guards.js';
import { canCancelFromState } from './state/order.transitions.js';
import { stepLog } from './utils/step.logger.js';

/**
 * Start a new order workflow.
 * Called from order controller after CardOrder is created.
 *
 * @param {string} orderId
 * @param {object} actor - { id, role, schoolId }
 * @returns {Promise<object>}
 */
export async function startOrder(orderId, actor) {
  logger.info({ msg: 'Starting order orchestration', orderId, actor });

  // Guard: only school admin can create orders
  const schoolGuard = guardSchoolAdmin(actor);
  if (!schoolGuard.pass) {
    throw new Error(schoolGuard.reason);
  }

  // Guard: order exists
  const orderGuard = await guardOrderExists(orderId);
  if (!orderGuard.pass) {
    throw new Error(orderGuard.reason);
  }

  const order = orderGuard.order;

  // Ensure order belongs to the actor's school
  if (actor.schoolId && order.school_id !== actor.schoolId) {
    throw new Error('Order does not belong to your school');
  }

  // Acquire lock to prevent duplicate pipeline creation
  const lockAcquired = await acquireLock(orderId, 'start');
  if (!lockAcquired) {
    throw new Error('Another process is already starting this order');
  }

  try {
    // Check if pipeline already exists
    const existingPipeline = await prisma.orderPipeline.findFirst({
      where: { order_id: orderId },
    });

    if (existingPipeline) {
      logger.info({ msg: 'Pipeline already exists', orderId });
      return {
        success: true,
        pipelineId: existingPipeline.id,
        currentStep: existingPipeline.current_step,
        overallProgress: existingPipeline.overall_progress,
      };
    }

    // Create pipeline record
    const pipeline = await prisma.orderPipeline.create({
      data: {
        order_id: orderId,
        current_step: 'CONFIRM',
        overall_progress: 5,
        started_at: new Date(),
      },
    });

    // Publish ORDER_CREATED event
    await publishEvent(ORDER_EVENTS.ORDER_CREATED, orderId, {
      schoolId: order.school_id,
      orderType: order.order_type,
      cardCount: order.card_count,
      channel: order.channel,
    });

    logger.info({
      msg: 'Order orchestration started',
      orderId,
      pipelineId: pipeline.id,
    });

    return {
      success: true,
      pipelineId: pipeline.id,
      currentStep: 'CONFIRM',
      overallProgress: 5,
    };
  } finally {
    await releaseLock(orderId, 'start');
  }
}

/**
 * Approve an order (super admin only).
 * Called from super admin controller.
 *
 * @param {string} orderId
 * @param {object} actor - { id, role }
 * @param {object} meta - { notes, metadata }
 * @returns {Promise<object>}
 */
export async function approveOrder(orderId, actor, meta = {}) {
  logger.info({ msg: 'Approving order', orderId, actor, meta });

  // Guard: only super admin can approve
  const adminGuard = guardSuperAdmin(actor);
  if (!adminGuard.pass) {
    throw new Error(adminGuard.reason);
  }

  // Guard: order exists
  const orderGuard = await guardOrderExists(orderId);
  if (!orderGuard.pass) {
    throw new Error(orderGuard.reason);
  }

  // Check current state
  const currentState = await getOrderState(orderId);

  if (currentState !== 'PENDING_APPROVAL') {
    throw new Error(`Order cannot be approved from state: ${currentState}`);
  }

  // Acquire lock to prevent concurrent approval
  const lockAcquired = await acquireLock(orderId, 'approve');
  if (!lockAcquired) {
    throw new Error('Another process is already approving this order');
  }

  try {
    // Transition to APPROVED
    await transitionState(orderId, 'APPROVED', actor.id, {
      notes: meta.notes,
      metadata: meta.metadata,
    });

    // Publish ORDER_APPROVED event
    await publishEvent(ORDER_EVENTS.ORDER_APPROVED, orderId, {
      approvedBy: actor.id,
      notes: meta.notes,
    });

    // Notify school
    const order = orderGuard.order;
    await publishNotification('ORDER_APPROVED', orderId, order.school_id, {
      orderNumber: order.order_number,
      approvedBy: actor.id,
      notes: meta.notes,
    });

    return {
      success: true,
      orderId,
      newState: 'APPROVED',
    };
  } finally {
    await releaseLock(orderId, 'approve');
  }
}

/**
 * Handle advance payment received.
 * Called from payment webhook or manual entry by super admin.
 *
 * @param {string} orderId
 * @param {object} paymentData - { amount, reference, provider, providerRef }
 * @param {object} actor - { id, role }
 * @returns {Promise<object>}
 */
export async function handlePayment(orderId, paymentData, actor) {
  logger.info({ msg: 'Processing payment', orderId, paymentData, actor });

  // Guard: order exists
  const orderGuard = await guardOrderExists(orderId);
  if (!orderGuard.pass) {
    throw new Error(orderGuard.reason);
  }

  // Check current state
  const currentState = await getOrderState(orderId);

  if (currentState !== 'ADVANCE_PENDING') {
    throw new Error(`Payment cannot be processed from state: ${currentState}`);
  }

  // Acquire lock to prevent duplicate payment processing
  const lockAcquired = await acquireLock(orderId, 'payment');
  if (!lockAcquired) {
    throw new Error('Another process is already processing payment for this order');
  }

  try {
    // Create payment record
    const payment = await prisma.payment.create({
      data: {
        school_id: orderGuard.order.school_id,
        order_id: orderId,
        amount: paymentData.amount,
        status: 'SUCCESS',
        provider: paymentData.provider || 'manual',
        provider_ref: paymentData.providerRef,
        payment_mode: paymentData.paymentMode || 'BANK_TRANSFER',
        is_advance: true,
        metadata: {
          reference: paymentData.reference,
          notes: paymentData.notes,
          processedBy: actor.id,
        },
      },
    });

    // Update CardOrder payment status
    await prisma.cardOrder.update({
      where: { id: orderId },
      data: {
        payment_status: 'PARTIALLY_PAID',
        advance_paid_at: new Date(),
        status: 'ADVANCE_RECEIVED',
      },
    });

    // Update subscription advance paid
    const order = orderGuard.order;
    if (order.subscription_id) {
      await prisma.subscription.update({
        where: { id: order.subscription_id },
        data: {
          advance_paid: {
            increment: paymentData.amount,
          },
          balance_due: {
            decrement: paymentData.amount,
          },
        },
      });
    }

    // Transition to ADVANCE_PAID
    await transitionState(orderId, 'ADVANCE_PAID', actor.id, {
      paymentId: payment.id,
      amount: paymentData.amount,
      reference: paymentData.reference,
    });

    // Publish ADVANCE_PAYMENT_RECEIVED event
    await publishEvent(ORDER_EVENTS.ADVANCE_PAYMENT_RECEIVED, orderId, {
      paymentId: payment.id,
      amount: paymentData.amount,
      reference: paymentData.reference,
    });

    // Notify school
    await publishNotification('ADVANCE_PAYMENT_RECEIVED', orderId, order.school_id, {
      orderNumber: order.order_number,
      amount: paymentData.amount / 100,
      reference: paymentData.reference,
    });

    return {
      success: true,
      paymentId: payment.id,
      orderId,
      newState: 'ADVANCE_PAID',
    };
  } finally {
    await releaseLock(orderId, 'payment');
  }
}

/**
 * Cancel an order (super admin only).
 * Applies all cancellation business rules.
 *
 * @param {string} orderId
 * @param {object} actor - { id, role }
 * @param {object} meta - { reason, notes }
 * @returns {Promise<object>}
 */
export async function cancelOrder(orderId, actor, meta = {}) {
  logger.info({ msg: 'Cancelling order', orderId, actor, meta });

  // Evaluate cancellation policy
  const evaluation = await evaluateCancellation(orderId, actor);

  if (!evaluation.allowed) {
    throw new Error(evaluation.reason);
  }

  // Acquire lock
  const lockAcquired = await acquireLock(orderId, 'cancel');
  if (!lockAcquired) {
    throw new Error('Another process is already cancelling this order');
  }

  try {
    // Get order details
    const order = await prisma.cardOrder.findUnique({
      where: { id: orderId },
      include: {
        tokens: true,
      },
    });

    if (!order) {
      throw new Error(`Order ${orderId} not found`);
    }

    // Revoke any generated tokens
    if (order.tokens.length > 0) {
      await prisma.token.updateMany({
        where: { order_id: orderId },
        data: {
          status: 'REVOKED',
          revoked_at: new Date(),
        },
      });
    }

    // Update order status
    await prisma.cardOrder.update({
      where: { id: orderId },
      data: {
        status: 'CANCELLED',
        status_note: meta.reason,
        status_changed_by: actor.id,
        status_changed_at: new Date(),
      },
    });

    // Create status log
    await prisma.orderStatusLog.create({
      data: {
        order_id: orderId,
        from_status: order.status,
        to_status: 'CANCELLED',
        changed_by: actor.id,
        note: meta.reason,
        metadata: {
          notes: meta.notes,
          cancelledBy: actor.id,
        },
      },
    });

    // Transition state
    await transitionState(orderId, 'CANCELLED', actor.id, {
      reason: meta.reason,
      notes: meta.notes,
      tokensRevoked: order.tokens.length,
    });

    // Publish ORDER_CANCELLED event
    await publishEvent(ORDER_EVENTS.ORDER_CANCELLED, orderId, {
      reason: meta.reason,
      cancelledBy: actor.id,
      tokensRevoked: order.tokens.length,
    });

    // Notify school
    await publishNotification('ORDER_CANCELLED', orderId, order.school_id, {
      orderNumber: order.order_number,
      reason: meta.reason,
    });

    return {
      success: true,
      orderId,
      newState: 'CANCELLED',
      tokensRevoked: order.tokens.length,
    };
  } finally {
    await releaseLock(orderId, 'cancel');
  }
}

/**
 * Get order status and progress.
 * Called from dashboard and API endpoints.
 *
 * @param {string} orderId
 * @returns {Promise<object>}
 */
export async function getOrderStatus(orderId) {
  const state = await getOrderState(orderId);

  const pipeline = await prisma.orderPipeline.findFirst({
    where: { order_id: orderId },
    select: {
      current_step: true,
      overall_progress: true,
      is_stalled: true,
      stalled_at: true,
      stalled_reason: true,
      started_at: true,
      completed_at: true,
    },
  });

  const order = await prisma.cardOrder.findUnique({
    where: { id: orderId },
    select: {
      status: true,
      payment_status: true,
      advance_paid_at: true,
      balance_paid_at: true,
      tokens_generated_at: true,
      print_complete_at: true,
      shipment: {
        select: {
          status: true,
          awb_code: true,
          courier_name: true,
          tracking_url: true,
          delivered_at: true,
        },
      },
    },
  });

  return {
    orderId,
    state,
    dbStatus: order?.status,
    paymentStatus: order?.payment_status,
    pipeline: pipeline || null,
    milestones: {
      advancePaid: order?.advance_paid_at,
      tokensGenerated: order?.tokens_generated_at,
      printComplete: order?.print_complete_at,
      balancePaid: order?.balance_paid_at,
    },
    shipment: order?.shipment || null,
  };
}

/**
 * Resume a stalled pipeline.
 * Called by stalled pipeline detection job.
 *
 * @param {string} orderId
 * @returns {Promise<object>}
 */
export async function resumeStalledPipeline(orderId) {
  const pipeline = await prisma.orderPipeline.findFirst({
    where: { order_id: orderId, is_stalled: true },
  });

  if (!pipeline) {
    return { success: false, message: 'Pipeline not stalled' };
  }

  // Clear stalled flag
  await prisma.orderPipeline.update({
    where: { id: pipeline.id },
    data: {
      is_stalled: false,
      stalled_at: null,
      stalled_reason: null,
    },
  });

  // Re-publish current event based on current step
  const currentStep = pipeline.current_step;
  const state = await getOrderState(orderId);

  logger.info({
    msg: 'Resuming stalled pipeline',
    orderId,
    currentStep,
    state,
  });

  return {
    success: true,
    orderId,
    currentStep,
    state,
  };
}
