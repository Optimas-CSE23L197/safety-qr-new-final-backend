// =============================================================================
// requestId.middleware.js — RESQID
// Unique request ID for every incoming request
// Used in logs, error responses, and distributed tracing
// =============================================================================

import crypto from "crypto";

const HEADER = "x-request-id";
const ID_REGEX = /^[a-zA-Z0-9_-]{8,64}$/; // safe format

/**
 * requestId
 * Assigns a unique ID to every request
 * If client sends X-Request-ID and it's valid format → use it (idempotency)
 * Otherwise → generate a fresh one
 * Always echoes the ID back in response headers
 */
export function requestId(req, res, next) {
  const clientId = req.headers[HEADER];

  // Accept client-provided ID only if it matches safe format
  const id =
    clientId && ID_REGEX.test(clientId) ? clientId : crypto.randomUUID();

  req.id = id;
  req.requestId = id; // alias for convenience

  // Echo back in response — client can correlate logs
  res.setHeader(HEADER, id);
  res.setHeader("x-response-time-start", Date.now().toString());

  next();
}
