// =============================================================================
// error.middleware.js — RESQID
// Global error handler — last line of defence
// Single responsibility: catch everything, leak nothing, log everything
//
// Rules:
//   - NEVER expose stack traces in production
//   - NEVER expose DB/internal error messages in production
//   - NEVER expose which table/field caused a Prisma error
//   - ALWAYS return consistent ApiError shape
//   - ALWAYS log full error internally with requestId
//   - Operational errors (ApiError) → specific status + message
//   - Programming errors (unexpected) → 500 + generic message
// =============================================================================

import { Prisma } from '../../src/generated/index.js';
import { ZodError } from 'zod';
import { logger } from '#config/logger.js';
import { ENV } from '#config/env.js';

const IS_PROD = ENV.NODE_ENV === 'production';

// ─── Error Response Shape ─────────────────────────────────────────────────────
// ALL errors from this API look exactly like this — no exceptions

function errorResponse(res, { statusCode, message, errors = null, requestId }) {
  const body = {
    success: false,
    message,
    requestId,
    timestamp: new Date().toISOString(),
    ...(errors && { errors }),
    // Stack trace ONLY in development — never in production
    ...(!IS_PROD && res.locals._stack && { stack: res.locals._stack }),
  };
  return res.status(statusCode).json(body);
}

// ─── Global Error Handler ─────────────────────────────────────────────────────

// Must have 4 arguments — Express identifies error middleware by arity
// eslint-disable-next-line no-unused-vars
export function globalErrorHandler(err, req, res, next) {
  const requestId = req.id ?? req.requestId ?? 'unknown';
  const log = req.log ?? logger;

  // Store stack for dev response (never sent in prod)
  if (!IS_PROD) res.locals._stack = err.stack;

  // ── 1. Operational Error — ApiError thrown intentionally ──────────────────
  if (err.isOperational) {
    // Warn level — these are expected (bad input, auth failures, etc.)
    log.warn(
      {
        type: 'operational_error',
        statusCode: err.statusCode,
        message: err.message,
        errors: err.errors,
        path: req.path,
        method: req.method,
        userId: req.userId,
      },
      `Operational error: ${err.message}`
    );

    return errorResponse(res, {
      statusCode: err.statusCode,
      message: err.message,
      errors: err.errors,
      requestId,
    });
  }

  // ── 2. Zod Validation Error — schema parse failed ─────────────────────────
  if (err instanceof ZodError) {
    const errors = err.errors.map(e => ({
      field: e.path.join('.'),
      message: e.message,
      code: e.code,
    }));

    log.warn({ type: 'validation_error', errors, path: req.path }, 'Zod validation error');

    return errorResponse(res, {
      statusCode: 422,
      message: 'Validation failed',
      errors,
      requestId,
    });
  }

  // ── 3. Prisma Errors — DB-level failures ──────────────────────────────────
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    return handlePrismaKnownError(err, req, res, requestId, log);
  }

  if (err instanceof Prisma.PrismaClientValidationError) {
    log.error(
      { type: 'prisma_validation', path: req.path, userId: req.userId },
      'Prisma validation error — schema mismatch in query'
    );

    return errorResponse(res, {
      statusCode: 400,
      message: 'Invalid data provided',
      requestId,
    });
  }

  if (
    err instanceof Prisma.PrismaClientInitializationError ||
    err instanceof Prisma.PrismaClientRustPanicError
  ) {
    log.fatal({ type: 'prisma_init_error', err }, 'Prisma init/panic — database unavailable');

    return errorResponse(res, {
      statusCode: 503,
      message: 'Database temporarily unavailable. Please try again shortly.',
      requestId,
    });
  }

  // ── 4. JWT Errors — should be caught by auth middleware, but safety net ───
  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    log.warn({ type: 'jwt_error', name: err.name }, 'JWT error reached error handler');
    return errorResponse(res, {
      statusCode: 401,
      message: 'Authentication failed',
      requestId,
    });
  }

  // ── 5. Multer / File Upload Errors ────────────────────────────────────────
  if (err.code === 'LIMIT_FILE_SIZE') {
    return errorResponse(res, {
      statusCode: 413,
      message: 'File size exceeds the allowed limit',
      requestId,
    });
  }

  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    return errorResponse(res, {
      statusCode: 400,
      message: 'Unexpected file field in upload',
      requestId,
    });
  }

  // ── 6. SyntaxError — malformed JSON body ──────────────────────────────────
  if (err instanceof SyntaxError && 'body' in err) {
    return errorResponse(res, {
      statusCode: 400,
      message: 'Request body contains invalid JSON',
      requestId,
    });
  }

  // ── 7. Programming Error / Unknown — never expose internals ───────────────
  // Full error logged internally, safe message sent to client
  log.error(
    {
      type: 'unexpected_error',
      err: {
        message: err.message,
        name: err.name,
        code: err.code,
        stack: err.stack,
      },
      path: req.path,
      method: req.method,
      userId: req.userId,
      schoolId: req.schoolId,
      requestId,
    },
    `Unexpected error: ${err.message}`
  );

  return errorResponse(res, {
    statusCode: 500,
    message: IS_PROD ? 'An unexpected error occurred. Our team has been notified.' : err.message, // Show real message in dev only
    requestId,
  });
}

// ─── 404 Handler — must be registered BEFORE globalErrorHandler ───────────────

export function notFoundHandler(req, res) {
  const requestId = req.id ?? 'unknown';
  const log = req.log ?? logger;

  log.warn(
    {
      type: 'not_found',
      method: req.method,
      url: req.originalUrl,
      userId: req.userId,
    },
    `404: ${req.method} ${req.path}`
  );

  return res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.path} not found`,
    requestId,
    timestamp: new Date().toISOString(),
  });
}

// ─── Prisma Known Error Handler ───────────────────────────────────────────────

function handlePrismaKnownError(err, req, res, requestId, log) {
  log.warn(
    {
      type: 'prisma_error',
      code: err.code,
      // NEVER log err.meta in production — contains table/field names
      ...(IS_PROD ? {} : { meta: err.meta }),
      path: req.path,
      userId: req.userId,
    },
    `Prisma error P${err.code}`
  );

  switch (err.code) {
    // Unique constraint violation
    case 'P2002': {
      const field = IS_PROD ? 'field' : (err.meta?.target?.[0] ?? 'field');
      return errorResponse(res, {
        statusCode: 409,
        message: `A record with this ${field} already exists`,
        requestId,
      });
    }

    // Record not found
    case 'P2025':
      return errorResponse(res, {
        statusCode: 404,
        message: 'The requested record was not found',
        requestId,
      });

    // Foreign key constraint failed
    case 'P2003':
      return errorResponse(res, {
        statusCode: 400,
        message: 'Referenced record does not exist',
        requestId,
      });

    // Required field null violation
    case 'P2011':
      return errorResponse(res, {
        statusCode: 400,
        message: 'A required field is missing',
        requestId,
      });

    // Value too long
    case 'P2000':
      return errorResponse(res, {
        statusCode: 400,
        message: 'A field value exceeds the maximum allowed length',
        requestId,
      });

    // Transaction conflict
    case 'P2034':
      return errorResponse(res, {
        statusCode: 409,
        message: 'Write conflict, please retry',
        requestId,
      });

    // Default — unknown Prisma known error
    default:
      return errorResponse(res, {
        statusCode: 500,
        message: IS_PROD ? 'A database error occurred' : `Prisma error ${err.code}`,
        requestId,
      });
  }
}

// ─── Unhandled Rejection / Exception Catchers ────────────────────────────────
// Register these ONCE in server.js — not here
// Exported so server.js can use them

export function setupProcessErrorHandlers(server) {
  // Unhandled promise rejections — log and exit gracefully
  process.on('unhandledRejection', (reason, promise) => {
    logger.fatal(
      { type: 'unhandled_rejection', reason, promise },
      'Unhandled promise rejection — shutting down'
    );
    gracefulShutdown(server, 1);
  });

  // Uncaught exceptions — ALWAYS exit — process state is undefined
  process.on('uncaughtException', err => {
    logger.fatal(
      { type: 'uncaught_exception', err },
      'Uncaught exception — shutting down immediately'
    );
    gracefulShutdown(server, 1);
  });

  // Graceful shutdown signals
  process.on('SIGTERM', () => {
    logger.info('SIGTERM received — shutting down gracefully');
    gracefulShutdown(server, 0);
  });

  process.on('SIGINT', () => {
    logger.info('SIGINT received — shutting down gracefully');
    gracefulShutdown(server, 0);
  });
}

function gracefulShutdown(server, code) {
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(code);
  });

  // Force kill after 10 seconds if graceful close fails
  setTimeout(() => {
    logger.error('Forced shutdown — server did not close in time');
    process.exit(code);
  }, 10_000).unref();
}
