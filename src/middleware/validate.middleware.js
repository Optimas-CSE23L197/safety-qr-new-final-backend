// =============================================================================
// validate.middleware.js — RESQID
// Zod-based schema validation — strict mode, no unknown fields pass through
// Single validation failure = immediate 422 with full error details
// =============================================================================

import { ZodError } from "zod";
import { ApiError } from "../utils/Response/ApiError.js";
import { asyncHandler } from "../utils/Response/asyncHandler.js";

// ─── Validation Targets ───────────────────────────────────────────────────────

/**
 * validate(schema, target?)
 * target: 'body' | 'query' | 'params' | 'all'
 * Default: 'body'
 *
 * Uses Zod .strict() behavior via schema definition
 * Unknown fields cause validation failure — no extra data leaks through
 */
export const validate = (schema, target = "body") =>
  asyncHandler(async (req, _res, next) => {
    const data = selectTarget(req, target);

    const result = schema.safeParse(data);

    if (!result.success) {
      const errors = formatZodErrors(result.error);
      throw ApiError.validationError("Validation failed", errors);
    }

    // Replace raw input with validated + transformed data
    // This ensures coerced types, defaults, and strips unknown fields
    assignTarget(req, target, result.data);

    next();
  });

/**
 * validateAll(schemas)
 * Validate multiple targets in one middleware
 * Usage: validateAll({ body: bodySchema, params: paramsSchema })
 */
export const validateAll = (schemas) =>
  asyncHandler(async (req, _res, next) => {
    const errors = [];

    for (const [target, schema] of Object.entries(schemas)) {
      const data = selectTarget(req, target);
      const result = schema.safeParse(data);

      if (!result.success) {
        errors.push(
          ...formatZodErrors(result.error).map((e) => ({
            ...e,
            location: target,
          })),
        );
      } else {
        assignTarget(req, target, result.data);
      }
    }

    if (errors.length > 0) {
      throw ApiError.validationError("Validation failed", errors);
    }

    next();
  });

// ─── Helpers ──────────────────────────────────────────────────────────────────

function selectTarget(req, target) {
  switch (target) {
    case "body":
      return req.body;
    case "query":
      return req.query;
    case "params":
      return req.params;
    case "all":
      return { body: req.body, query: req.query, params: req.params };
    default:
      return req.body;
  }
}

function assignTarget(req, target, data) {
  switch (target) {
    case "body":
      req.body = data;
      break;
    case "query":
      req.query = data;
      break;
    case "params":
      req.params = data;
      break;
    case "all":
      if (data.body) req.body = data.body;
      if (data.query) req.query = data.query;
      if (data.params) req.params = data.params;
      break;
  }
}

function formatZodErrors(error) {
  return error.errors.map((e) => ({
    field: e.path.join("."),
    message: e.message,
    code: e.code,
    ...(e.received !== undefined && { received: e.received }),
    ...(e.expected !== undefined && { expected: e.expected }),
  }));
}
