// =============================================================================
// orchestrator/events/event.consumer.js — RESQID
// consume(eventType, handler) — registers a typed handler.
// Workers call this to subscribe to specific event types from their queue.
//
// IMPORTANT: consume() must only be called from worker entry files, never from
// app.js or API routes. This registry is in-process — handlers registered in
// the API process will never fire because BullMQ jobs execute in the worker
// process. A worker context guard enforces this at startup.
// =============================================================================

import { EVENTS } from './event.types.js';
import { logger } from '#config/logger.js';

// ── Worker context guard ──────────────────────────────────────────────────────
// Set WORKER_PROCESS=true in worker entry files before importing this module.
// This prevents accidental consume() calls from the API process.

const _isWorkerProcess = process.env.WORKER_PROCESS === 'true';

// Registry: eventType → Set of handler functions
const _registry = new Map();

/**
 * Register a handler for a specific event type.
 * Multiple handlers for the same type are all called in registration order.
 *
 * MUST be called only from worker entry files (workers/index.js or individual
 * worker bootstraps). Set WORKER_PROCESS=true in the worker entry point.
 *
 * @param {string} eventType — must be a value from EVENTS
 * @param {function} handler — async (event) => void
 */
export const consume = (eventType, handler) => {
  if (!_isWorkerProcess) {
    throw new Error(
      `consume("${eventType}") called outside a worker process. ` +
        'Set WORKER_PROCESS=true in your worker entry file before importing event.consumer.js. ' +
        'Handlers registered in the API process will never fire.'
    );
  }

  if (!EVENTS[eventType]) {
    throw new TypeError(`consume: unknown event type "${eventType}"`);
  }

  if (typeof handler !== 'function') {
    throw new TypeError('consume: handler must be a function');
  }

  if (!_registry.has(eventType)) _registry.set(eventType, new Set());
  _registry.get(eventType).add(handler);

  logger.info({ eventType }, '[event.consumer] Handler registered');
};

/**
 * Dispatch an event to all registered handlers for its type.
 * Called internally by workers — not by application code.
 *
 * @param {object} event — full stamped event from BullMQ job data
 * @returns {Promise<void>}
 */
export const dispatch = async event => {
  const handlers = _registry.get(event.type);

  if (!handlers || handlers.size === 0) {
    logger.warn({ type: event.type }, '[event.consumer] No handlers registered for event type');
    return;
  }

  const results = await Promise.allSettled([...handlers].map(handler => handler(event)));

  for (const result of results) {
    if (result.status === 'rejected') {
      logger.error(
        { err: result.reason?.message, type: event.type },
        '[event.consumer] Handler threw an error'
      );
    }
  }
};

/**
 * Check if any handlers are registered for a given event type.
 * Used in tests and health checks.
 */
export const hasHandlers = eventType => {
  const handlers = _registry.get(eventType);
  return !!handlers && handlers.size > 0;
};

/**
 * Returns a snapshot of all registered event types.
 * Used in health checks and worker startup logging.
 */
export const registeredTypes = () => [..._registry.keys()];

/**
 * Returns count of registered handlers per event type.
 * Used in worker startup logging for visibility.
 */
export const registeredSummary = () => {
  const summary = {};
  for (const [type, handlers] of _registry.entries()) {
    summary[type] = handlers.size;
  }
  return summary;
};
