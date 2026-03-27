// =============================================================================
// services/orchestrator.service.js
// Main orchestration service that coordinates the entire order lifecycle.
// This is the primary entry point for the orchestrator module.
// =============================================================================

import { prisma } from '#config/database/prisma.js';
import { logger } from '#config/logger.js';
import {
  QUEUE_NAMES,
  JOB_NAMES,
  REDIS_KEYS,
  DISTRIBUTED_LOCK_TTL_MS,
} from './orchestrator.constants.js';
import { getQueue } from './queues/queue.manager.js';
import {
  claimExecution,
  markCompleted,
  releaseClaim,
  acquireLock,
  releaseLock,
} from './idempotency.service.js';
import {
  beginStepExecution,
  completeStepExecution,
  failStepExecution,
  updateStepProgress,
} from './execution.service.js';
import { getOrderState, transitionState, markStalled } from './state.service.js';
import { evaluateCancellation } from './policies/cancellation.policy.js';
import { guardSuperAdmin, guardSchoolAdmin, guardOrderExists } from './state/order.guards.js';
import { validateTransition } from './state/order.transitions.js';
import { publishEvent, publishNotification, publishFailure } from './events/event.publisher.js';
import { ORDER_EVENTS } from './events/event.types.js';
import { stepLog, stepError } from '#utils/step.logger.js';

// =============================================================================
// Internal helpers
// =============================================================================

/**
 * Safe wrapper around publishEvent.
 * Publishing to a queue must never crash an HTTP response path.
 * If BullMQ/Redis is temporarily unavailable, we log and continue.
 * The pipeline can be resumed via resumeStalledPipeline.
 */
async function safePublishEvent(event, orderId, payload) {
  try {
    await publishEvent(event, orderId, payload);
  } catch (err) {
    logger.error({
      msg: 'publishEvent failed — pipeline may stall, use resumeStalledPipeline to recover',
      event,
      orderId,
      err: err.message,
    });
    // Mark stalled so the admin dashboard surfaces it
    try {
      await markStalled(orderId, `Event publish failed: ${event} — ${err.message}`);
    } catch (stallErr) {
      logger.error({
        msg: 'markStalled also failed',
        orderId,
        err: stallErr.message,
      });
    }
    // Do NOT re-throw — the DB work above already succeeded, the HTTP response
    // must still return 200/201 to the caller
  }
}

/**
 * Safe wrapper around publishNotification.
 * Notification delivery is best-effort — never block or throw to the caller.
 */
async function safePublishNotification(type, orderId, schoolId, payload) {
  try {
    await publishNotification(type, orderId, schoolId, payload);
  } catch (err) {
    logger.warn({
      msg: 'publishNotification failed — non-fatal',
      type,
      orderId,
      err: err.message,
    });
  }
}

// =============================================================================
// ORDER LIFECYCLE MANAGEMENT
// =============================================================================

/**
 * Start a new order workflow.
 * Called from order controller after CardOrder is created.
 *
 * @param {string} orderId - CardOrder ID
 * @param {object} actor - { id, role, schoolId }
 * @param {object} options - { notes, metadata }
 * @returns {Promise<object>}
 */
export const startOrderOrchestration = async (orderId, actor, options = {}) => {
  logger.info({ msg: 'Starting order orchestration', orderId, actor, options });

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

    // Create initial step execution
    const stepExecution = await beginStepExecution(pipeline.id, orderId, 'CREATE', actor.id);

    await stepLog(
      stepExecution.id,
      orderId,
      'Order created and pipeline initialized',
      {
        orderType: order.order_type,
        cardCount: order.card_count,
        channel: order.channel,
      },
      null
    );

    // ✅ Use safePublishEvent — if BullMQ/Redis is down this must not crash
    // the controller response. The order and pipeline are already saved in DB.
    await safePublishEvent(ORDER_EVENTS.ORDER_CREATED, orderId, {
      schoolId: order.school_id,
      orderType: order.order_type,
      cardCount: order.card_count,
      channel: order.channel,
      createdBy: actor.id,
    });

    logger.info({
      msg: 'Order orchestration started',
      orderId,
      pipelineId: pipeline.id,
    });

    return {
      success: true,
      pipelineId: pipeline.id,
      stepExecutionId: stepExecution.id,
      currentStep: 'CONFIRM',
      overallProgress: 5,
    };
  } finally {
    await releaseLock(orderId, 'start');
  }
};

/**
 * Approve an order (super admin only).
 *
 * @param {string} orderId
 * @param {object} actor - { id, role }
 * @param {object} options - { notes, metadata }
 * @returns {Promise<object>}
 */
export const approveOrderOrchestration = async (orderId, actor, options = {}) => {
  logger.info({ msg: 'Approving order', orderId, actor, options });

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
  if (currentState !== 'PENDING') {
    throw new Error(`Order cannot be approved from state: ${currentState}`);
  }

  // Acquire lock
  const lockAcquired = await acquireLock(orderId, 'approve');
  if (!lockAcquired) {
    throw new Error('Another process is already approving this order');
  }

  try {
    // Get pipeline
    const pipeline = await prisma.orderPipeline.findFirst({
      where: { order_id: orderId },
    });

    if (!pipeline) {
      throw new Error(`Pipeline not found for order ${orderId}`);
    }

    // Create step execution for approval
    const stepExecution = await beginStepExecution(pipeline.id, orderId, 'CONFIRM', actor.id);

    await stepLog(
      stepExecution.id,
      orderId,
      'Super admin approving order',
      { notes: options.notes },
      null
    );

    // Transition to APPROVED
    await transitionState(orderId, 'APPROVED', actor.id, {
      notes: options.notes,
      metadata: options.metadata,
    });

    // Complete step execution
    await completeStepExecution(stepExecution.id, {
      approvedBy: actor.id,
      notes: options.notes,
    });

    // ✅ Safe publish — DB work above already committed
    await safePublishEvent(ORDER_EVENTS.ORDER_APPROVED, orderId, {
      approvedBy: actor.id,
      notes: options.notes,
    });

    const order = orderGuard.order;
    await safePublishNotification('ORDER_APPROVED', orderId, order.school_id, {
      orderNumber: order.order_number,
      approvedBy: actor.id,
      notes: options.notes,
    });

    return {
      success: true,
      orderId,
      stepExecutionId: stepExecution.id,
      newState: 'APPROVED',
    };
  } finally {
    await releaseLock(orderId, 'approve');
  }
};

/**
 * Handle advance payment received.
 * Called from payment webhook or manual entry by super admin.
 *
 * @param {string} orderId
 * @param {object} paymentData - { amount, reference, provider, providerRef, paymentMode }
 * @param {object} actor - { id, role }
 * @returns {Promise<object>}
 */
export const processPaymentOrchestration = async (orderId, paymentData, actor) => {
  logger.info({ msg: 'Processing payment', orderId, paymentData, actor });

  // Guard: order exists
  const orderGuard = await guardOrderExists(orderId);
  if (!orderGuard.pass) {
    throw new Error(orderGuard.reason);
  }

  // Check current state
  const currentState = await getOrderState(orderId);
  if (currentState !== 'PAYMENT_PENDING') {
    throw new Error(`Payment cannot be processed from state: ${currentState}`);
  }

  // Acquire lock
  const lockAcquired = await acquireLock(orderId, 'payment');
  if (!lockAcquired) {
    throw new Error('Another process is already processing payment for this order');
  }

  try {
    const order = orderGuard.order;

    // Get pipeline
    const pipeline = await prisma.orderPipeline.findFirst({
      where: { order_id: orderId },
    });

    if (!pipeline) {
      throw new Error(`Pipeline not found for order ${orderId}`);
    }

    // Create step execution for payment
    const stepExecution = await beginStepExecution(
      pipeline.id,
      orderId,
      'ADVANCE_PAYMENT',
      actor.id
    );

    await stepLog(
      stepExecution.id,
      orderId,
      'Processing advance payment',
      { amount: paymentData.amount, reference: paymentData.reference },
      null
    );

    // Create payment record
    const payment = await prisma.payment.create({
      data: {
        school_id: order.school_id,
        order_id: orderId,
        invoice_id: order.advance_invoice_id, // ✅ Link to invoice
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

    // ✅ Mark invoice as paid
    await prisma.invoice.update({
      where: { id: order.advance_invoice_id },
      data: { status: 'PAID', paid_at: new Date() },
    });

    // Update CardOrder payment status
    await prisma.cardOrder.update({
      where: { id: orderId },
      data: {
        payment_status: 'PARTIALLY_PAID',
        advance_paid_at: new Date(),
      },
    });

    // ✅ REMOVED subscription update — not in new schema

    // Transition to ADVANCE_PAID
    await transitionState(orderId, 'ADVANCE_PAID', actor.id, {
      paymentId: payment.id,
      amount: paymentData.amount,
      reference: paymentData.reference,
    });

    // Complete step execution
    await completeStepExecution(stepExecution.id, {
      paymentId: payment.id,
      amount: paymentData.amount,
      reference: paymentData.reference,
    });

    // Safe publish
    await safePublishEvent(ORDER_EVENTS.ADVANCE_PAYMENT_RECEIVED, orderId, {
      paymentId: payment.id,
      amount: paymentData.amount,
      reference: paymentData.reference,
    });

    await safePublishNotification('ADVANCE_PAYMENT_RECEIVED', orderId, order.school_id, {
      orderNumber: order.order_number,
      amount: paymentData.amount / 100,
      reference: paymentData.reference,
    });

    return {
      success: true,
      paymentId: payment.id,
      stepExecutionId: stepExecution.id,
      orderId,
      newState: 'ADVANCE_PAID',
    };
  } finally {
    await releaseLock(orderId, 'payment');
  }
};

/**
 * Cancel an order (super admin only).
 *
 * @param {string} orderId
 * @param {object} actor - { id, role }
 * @param {object} options - { reason, notes }
 * @returns {Promise<object>}
 */
export const cancelOrderOrchestration = async (orderId, actor, options = {}) => {
  logger.info({ msg: 'Cancelling order', orderId, actor, options });

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
    const order = await prisma.cardOrder.findUnique({
      where: { id: orderId },
      include: {
        tokens: true,
        pipeline: true,
      },
    });

    if (!order) {
      throw new Error(`Order ${orderId} not found`);
    }

    // Get or create pipeline
    let pipeline = order.pipeline;
    if (!pipeline) {
      pipeline = await prisma.orderPipeline.create({
        data: {
          order_id: orderId,
          current_step: 'CANCEL',
          overall_progress: 0,
          started_at: new Date(),
        },
      });
    }

    // Create step execution for cancellation
    const stepExecution = await beginStepExecution(pipeline.id, orderId, 'CANCEL', actor.id);

    await stepLog(
      stepExecution.id,
      orderId,
      'Cancelling order',
      { reason: options.reason, notes: options.notes },
      null
    );

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
        status_note: options.reason,
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
        note: options.reason,
        metadata: {
          notes: options.notes,
          cancelledBy: actor.id,
        },
      },
    });

    // Transition state
    await transitionState(orderId, 'CANCELLED', actor.id, {
      reason: options.reason,
      notes: options.notes,
      tokensRevoked: order.tokens.length,
    });

    // Complete step execution
    await completeStepExecution(stepExecution.id, {
      tokensRevoked: order.tokens.length,
      reason: options.reason,
    });

    // ✅ Safe publish
    await safePublishEvent(ORDER_EVENTS.ORDER_CANCELLED, orderId, {
      reason: options.reason,
      cancelledBy: actor.id,
      tokensRevoked: order.tokens.length,
    });

    await safePublishNotification('ORDER_CANCELLED', orderId, order.school_id, {
      orderNumber: order.order_number,
      reason: options.reason,
    });

    return {
      success: true,
      orderId,
      stepExecutionId: stepExecution.id,
      newState: 'CANCELLED',
      tokensRevoked: order.tokens.length,
    };
  } finally {
    await releaseLock(orderId, 'cancel');
  }
};

// =============================================================================
// STATUS & MONITORING
// =============================================================================

/**
 * Get order status and progress.
 *
 * @param {string} orderId
 * @returns {Promise<object>}
 */
export const getOrderStatusOrchestration = async orderId => {
  // ✅ Guard getOrderState — if Redis is flaky this must not throw to the caller.
  // We return state: 'UNKNOWN' and let the DB fields speak for themselves.
  let state = 'UNKNOWN';
  try {
    state = await getOrderState(orderId);
  } catch (err) {
    logger.warn({
      msg: 'getOrderState failed in status query — using UNKNOWN',
      orderId,
      err: err.message,
    });
  }

  const pipeline = await prisma.orderPipeline.findFirst({
    where: { order_id: orderId },
    select: {
      id: true,
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
      id: true,
      order_number: true,
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

  // ✅ Return null orderId so the controller can cleanly 404 without throwing
  if (!order) {
    return { orderId: null };
  }

  // Get recent step executions for timeline
  const recentSteps = await prisma.orderStepExecution.findMany({
    where: { order_id: orderId },
    orderBy: { triggered_at: 'desc' },
    take: 10,
    select: {
      step: true,
      status: true,
      started_at: true,
      completed_at: true,
      triggered_by: true,
      result_summary: true,
    },
  });

  return {
    orderId,
    orderNumber: order.order_number,
    state,
    dbStatus: order.status,
    paymentStatus: order.payment_status,
    pipeline: pipeline || null,
    milestones: {
      advancePaid: order.advance_paid_at,
      tokensGenerated: order.tokens_generated_at,
      printComplete: order.print_complete_at,
      balancePaid: order.balance_paid_at,
    },
    shipment: order.shipment || null,
    recentSteps,
  };
};

/**
 * Get all orders with optional filters (for dashboard)
 *
 * @param {object} filters - { status, schoolId, fromDate, toDate, limit, offset }
 * @param {object} actor - { id, role, schoolId }
 * @returns {Promise<object>}
 */
export const listOrdersOrchestration = async (filters = {}, actor) => {
  const where = {};

  // Apply tenant isolation
  if (actor.role === 'SCHOOL_ADMIN') {
    where.school_id = actor.schoolId;
  }

  if (filters.status) {
    where.status = filters.status;
  }

  if (filters.schoolId && actor.role === 'SUPER_ADMIN') {
    where.school_id = filters.schoolId;
  }

  if (filters.fromDate) {
    where.created_at = { gte: new Date(filters.fromDate) };
  }

  if (filters.toDate) {
    where.created_at = { ...where.created_at, lte: new Date(filters.toDate) };
  }

  const [orders, total] = await Promise.all([
    prisma.cardOrder.findMany({
      where,
      include: {
        school: {
          select: { id: true, name: true, code: true },
        },
        pipeline: {
          select: {
            current_step: true,
            overall_progress: true,
            is_stalled: true,
          },
        },
      },
      orderBy: { created_at: 'desc' },
      take: filters.limit || 50,
      skip: filters.offset || 0,
    }),
    prisma.cardOrder.count({ where }),
  ]);

  return { orders, total };
};

// =============================================================================
// RESUME & RECOVERY
// =============================================================================

/**
 * Resume a stalled pipeline.
 *
 * @param {string} orderId
 * @returns {Promise<object>}
 */
export const resumeStalledPipelineOrchestration = async orderId => {
  const pipeline = await prisma.orderPipeline.findFirst({
    where: { order_id: orderId, is_stalled: true },
  });

  if (!pipeline) {
    return { success: false, message: 'Pipeline not stalled or not found' };
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

  // Get current state
  const state = await getOrderState(orderId);
  const currentStep = pipeline.current_step;

  logger.info({
    msg: 'Resuming stalled pipeline',
    orderId,
    currentStep,
    state,
  });

  // Map step to event to re-publish
  const stepToEvent = {
    CONFIRM: ORDER_EVENTS.ORDER_CREATED,
    ADVANCE_INVOICE: ORDER_EVENTS.ORDER_APPROVED,
    ADVANCE_PAYMENT: ORDER_EVENTS.ADVANCE_PAYMENT_REQUESTED,
    TOKEN_GENERATION: ORDER_EVENTS.ADVANCE_PAYMENT_RECEIVED,
    CARD_DESIGN: ORDER_EVENTS.TOKEN_GENERATED,
    VENDOR_DISPATCH: ORDER_EVENTS.CARD_GENERATED,
    PRINTING_START: ORDER_EVENTS.DESIGN_COMPLETED,
    PRINTING_DONE: ORDER_EVENTS.PRINTING_STARTED,
    SHIPMENT_CREATE: ORDER_EVENTS.PRINTING_DONE,
    DELIVERY: ORDER_EVENTS.SHIPPED,
    BALANCE_INVOICE: ORDER_EVENTS.DELIVERED,
    BALANCE_PAYMENT: ORDER_EVENTS.ORDER_COMPLETED,
  };

  const eventToPublish = stepToEvent[currentStep];
  if (eventToPublish) {
    // Resume is an intentional recovery action — throw if publish fails here
    // so the admin knows the queue is still unavailable
    await publishEvent(eventToPublish, orderId, {
      resumed: true,
      stalledStep: currentStep,
    });
  }

  return {
    success: true,
    orderId,
    currentStep,
    state,
    eventPublished: eventToPublish,
  };
};

/**
 * Retry a failed step manually (super admin override)
 *
 * @param {string} orderId
 * @param {string} step
 * @param {object} actor
 * @param {object} options
 * @returns {Promise<object>}
 */
export const retryFailedStepOrchestration = async (orderId, step, actor, options = {}) => {
  logger.info({ msg: 'Manual retry of failed step', orderId, step, actor });

  // Find the failed step execution
  const failedStep = await prisma.orderStepExecution.findFirst({
    where: {
      order_id: orderId,
      step,
      status: 'FAILED',
    },
    orderBy: { attempt_number: 'desc' },
  });

  if (!failedStep) {
    throw new Error(`No failed step found for ${step} in order ${orderId}`);
  }

  // Clear idempotency claim for this step
  await releaseClaim(orderId, step.toLowerCase().replace(/_/g, ''));

  // Map step to event
  const stepToEvent = {
    CONFIRM: ORDER_EVENTS.ORDER_CREATED,
    ADVANCE_PAYMENT: ORDER_EVENTS.ADVANCE_PAYMENT_REQUESTED,
    TOKEN_GENERATION: ORDER_EVENTS.ADVANCE_PAYMENT_RECEIVED,
    CARD_DESIGN: ORDER_EVENTS.TOKEN_GENERATED,
    VENDOR_DISPATCH: ORDER_EVENTS.CARD_GENERATED,
    PRINTING_START: ORDER_EVENTS.DESIGN_COMPLETED,
    SHIPMENT_CREATE: ORDER_EVENTS.PRINTING_DONE,
    DELIVERY: ORDER_EVENTS.SHIPPED,
    BALANCE_PAYMENT: ORDER_EVENTS.DELIVERED,
  };

  const event = stepToEvent[step];
  if (event) {
    // Manual retry is explicit — let it throw if queue is unavailable
    await publishEvent(event, orderId, {
      manualRetry: true,
      retriedBy: actor.id,
      originalStepExecutionId: failedStep.id,
      notes: options.notes,
    });
  }

  return {
    success: true,
    orderId,
    step,
    eventPublished: event,
    originalStepExecutionId: failedStep.id,
  };
};

// =============================================================================
// EXPORTS
// =============================================================================

export default {
  startOrderOrchestration,
  approveOrderOrchestration,
  processPaymentOrchestration,
  cancelOrderOrchestration,
  getOrderStatusOrchestration,
  listOrdersOrchestration,
  resumeStalledPipelineOrchestration,
  retryFailedStepOrchestration,
};
