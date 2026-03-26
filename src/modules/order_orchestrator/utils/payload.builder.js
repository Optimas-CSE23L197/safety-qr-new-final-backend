// =============================================================================
// utils/payload.builder.js
// Helper to build job payloads for workers.
// =============================================================================

import { v4 as uuidv4 } from "uuid";

/**
 * Build standard job payload for pipeline workers
 */
export function buildPipelineJobPayload(orderId, event, options = {}) {
  return {
    orderId,
    event,
    stepExecutionId: options.stepExecutionId || null,
    jobExecutionId: options.jobExecutionId || uuidv4(),
    payload: options.payload || {},
    timestamp: new Date().toISOString(),
    traceId: options.traceId || uuidv4(),
    retryCount: options.retryCount || 0,
  };
}

/**
 * Build notification job payload
 */
export function buildNotificationPayload(
  type,
  orderId,
  recipientId,
  recipientType,
  templateData,
  idempotencyKey = null,
) {
  return {
    type,
    orderId,
    recipientId,
    recipientType,
    templateData,
    idempotencyKey:
      idempotencyKey || `${type}:${orderId}:${recipientId}:${Date.now()}`,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Build token generation payload
 */
export function buildTokenGenerationPayload(
  orderId,
  batchId,
  batchSize,
  startIndex,
  options = {},
) {
  return {
    orderId,
    batchId,
    batchSize,
    startIndex,
    ...options,
    timestamp: new Date().toISOString(),
    traceId: options.traceId || uuidv4(),
  };
}

/**
 * Build card design payload
 */
export function buildCardDesignPayload(
  orderId,
  cardIds,
  templateId,
  options = {},
) {
  return {
    orderId,
    cardIds,
    templateId,
    ...options,
    timestamp: new Date().toISOString(),
    traceId: options.traceId || uuidv4(),
  };
}

/**
 * Build shipment payload
 */
export function buildShipmentPayload(orderId, shipmentData, options = {}) {
  return {
    orderId,
    shipmentData,
    ...options,
    timestamp: new Date().toISOString(),
    traceId: options.traceId || uuidv4(),
  };
}

/**
 * Build failure payload
 */
export function buildFailurePayload(orderId, step, error, context = {}) {
  return {
    orderId,
    step,
    error: {
      message: error.message,
      stack: error.stack,
      name: error.name,
    },
    context,
    timestamp: new Date().toISOString(),
    traceId: context.traceId || uuidv4(),
  };
}
