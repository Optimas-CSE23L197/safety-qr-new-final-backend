//=============================================================================
// ApiError.js — RESQID
// Operational error class — intentional errors with known status codes
// isOperational = true → error.middleware.js handles gracefully
// isOperational = false (default Error) → 500 + "unexpected error" message
// =============================================================================

export class ApiError extends Error {
  /**
   * @param {number} statusCode  - HTTP status code
   * @param {string} message     - Human-readable message (sent to client)
   * @param {Array}  [errors]    - Field-level validation errors
   * @param {string} [code]      - Machine-readable error code for client logic
   */

  constructor(statusCode, message, errors = null, code = null) {
    super(message);

    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.message = message;
    this.errors = errors;
    this.code = code;
    this.isOperational = true;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ApiError);
    }
  }

  // ─── Static Factories ──────────────────────────────────────────────────────
  // Use these everywhere — never call `new ApiError(400, ...)` directly

  // 400
  static badRequest(message = 'Bad request', errors = null) {
    return new ApiError(400, message, errors, 'BAD_REQUEST');
  }

  static validationError(message = 'Validation failed', errors = null) {
    return new ApiError(422, message, errors, 'VALIDATION_ERROR');
  }

  // 401
  static unauthorized(message = 'Authentication required') {
    return new ApiError(401, message, null, 'UNAUTHORIZED');
  }

  static tokenExpired() {
    return new ApiError(401, 'Access token expired', null, 'TOKEN_EXPIRED');
  }

  static tokenRevoked() {
    return new ApiError(401, 'Token has been revoked', null, 'TOKEN_REVOKED');
  }

  static sessionExpired() {
    return new ApiError(401, 'Session has expired', null, 'SESSION_EXPIRED');
  }

  // 403
  static forbidden(message = 'Access denied') {
    return new ApiError(403, message, null, 'FORBIDDEN');
  }

  static cardInactive() {
    return new ApiError(403, 'This QR code is no longer active', null, 'CARD_INACTIVE');
  }

  static cardRevoked() {
    return new ApiError(403, 'This card has been revoked', null, 'CARD_REVOKED');
  }

  static profileHidden() {
    return new ApiError(
      403,
      'This emergency profile is not publicly visible',
      null,
      'PROFILE_HIDDEN'
    );
  }

  // 404
  static notFound(resource = 'Resource') {
    return new ApiError(404, `${resource} not found`, null, 'NOT_FOUND');
  }

  static tokenNotFound() {
    return new ApiError(404, 'QR code not found', null, 'TOKEN_NOT_FOUND');
  }

  static studentNotFound() {
    return new ApiError(404, 'Student profile not found', null, 'STUDENT_NOT_FOUND');
  }

  // 409
  static conflict(message = 'Resource already exists') {
    return new ApiError(409, message, null, 'CONFLICT');
  }

  // 410
  static tokenExpiredPermanent() {
    return new ApiError(
      410,
      'This QR code has permanently expired',
      null,
      'TOKEN_EXPIRED_PERMANENT'
    );
  }

  // 413
  static payloadTooLarge(message = 'Request payload too large') {
    return new ApiError(413, message, null, 'PAYLOAD_TOO_LARGE');
  }

  // 422
  static unprocessable(message = 'Unprocessable entity', errors = null) {
    return new ApiError(422, message, errors, 'UNPROCESSABLE');
  }

  // 429
  static tooManyRequests(message = 'Too many requests', retryAfter = null) {
    const err = new ApiError(429, message, null, 'RATE_LIMITED');
    if (retryAfter) err.retryAfter = retryAfter;
    return err;
  }

  // In ApiError.js, add this static method:

  // 500
  static internal(message = 'Internal server error') {
    return new ApiError(500, message, null, 'INTERNAL_ERROR');
  }

  // 503
  static serviceUnavailable(service = 'Service') {
    return new ApiError(503, `${service} is temporarily unavailable`, null, 'SERVICE_UNAVAILABLE');
  }

  // ─── Serializer ────────────────────────────────────────────────────────────

  toJSON() {
    return {
      success: false,
      message: this.message,
      code: this.code,
      statusCode: this.statusCode,
      ...(this.errors && { errors: this.errors }),
      ...(this.retryAfter && { retryAfter: this.retryAfter }),
    };
  }
}
