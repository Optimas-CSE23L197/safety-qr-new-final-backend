// =============================================================================
// validate.middleware.js — RESQID
// Zod-based schema validation — strict mode, no unknown fields pass through
// Single validation failure = immediate 422 with full error details
//
// FIX [#12]: assignTarget() was using direct assignment for req.query and
// req.params — both are getter-only on IncomingMessage and throw a TypeError
// on direct reassignment. Fixed with Object.assign() to mutate in-place.
// Same pattern used across sanitize.middleware.js and xss.middleware.js.
// req.body remains a direct assignment (writable property from express.json).
// =============================================================================

import { ZodError } from 'zod';
import { ApiError } from '#shared/response/ApiError.js';
import { asyncHandler } from '#shared/response/asyncHandler.js';

// ─── Validation Targets ───────────────────────────────────────────────────────

/**
 * validate(schema, target?)
 * target: 'body' | 'query' | 'params' | 'all'
 * Default: 'body'
 *
 * Usage:
 *   validate(mySchema)              → validates req.body
 *   validate(mySchema, "query")     → validates req.query
 *   validate(mySchema, "params")    → validates req.params
 *
 * Do NOT pass an object: validate({ body: mySchema }) — that is validateAll().
 *
 * Uses Zod .strict() behavior via schema definition.
 * Unknown fields cause validation failure — no extra data leaks through.
 */
export const validate = schema =>
  asyncHandler(async (req, _res, next) => {
    // Auto-detect schema shape:
    //   envelope shape  — z.object({ body: z.object(...), params?, query? })
    //   flat shape      — z.object({ email, password, ... }) — validates req.body directly
    //
    // Detection: if the schema has a "body" key in its shape, it is an envelope schema.
    // Otherwise treat it as a flat body schema (legacy auth routes).
    const isEnvelope =
      typeof schema.shape === 'object' && schema.shape !== null && 'body' in schema.shape;

    let data, result;

    if (isEnvelope) {
      data = {
        body: req.body ?? {},
        query: req.query ?? {},
        params: req.params ?? {},
      };
      result = schema.safeParse(data);
      if (!result.success) {
        throw ApiError.validationError('Validation failed', formatZodErrors(result.error));
      }
      if (result.data.body !== undefined) req.body = result.data.body;
      if (result.data.query !== undefined) Object.assign(req.query, result.data.query);
      if (result.data.params !== undefined) Object.assign(req.params, result.data.params);
    } else {
      // Flat schema — validate req.body directly (auth routes)
      data = req.body ?? {};
      result = schema.safeParse(data);
      if (!result.success) {
        throw ApiError.validationError('Validation failed', formatZodErrors(result.error));
      }
      req.body = result.data;
    }

    next();
  });

/**
 * validateAll(schemas)
 * Validate multiple targets in one middleware.
 * Usage: validateAll({ body: bodySchema, params: paramsSchema })
 *
 * Use this when a route needs simultaneous body + params or body + query
 * validation. For single-target validation use validate() instead.
 */
export const validateAll = schemas =>
  asyncHandler(async (req, _res, next) => {
    const errors = [];

    for (const [target, schema] of Object.entries(schemas)) {
      const data = selectTarget(req, target);
      const result = schema.safeParse(data);

      if (!result.success) {
        errors.push(
          ...formatZodErrors(result.error).map(e => ({
            ...e,
            location: target,
          }))
        );
      } else {
        assignTarget(req, target, result.data);
      }
    }

    if (errors.length > 0) {
      throw ApiError.validationError('Validation failed', errors);
    }

    next();
  });

// ─── Helpers ──────────────────────────────────────────────────────────────────

function selectTarget(req, target) {
  switch (target) {
    case 'body':
      return req.body;
    case 'query':
      return req.query;
    case 'params':
      return req.params;
    case 'all':
      return { body: req.body, query: req.query, params: req.params };
    default:
      return req.body;
  }
}

/**
 * assignTarget
 * Writes validated Zod output back onto the request object.
 *
 * NOTE on assignment strategy:
 *   req.body   → direct reassignment OK (writable property set by express.json)
 *   req.query  → Object.assign required (getter-only on IncomingMessage)
 *   req.params → Object.assign required (getter-only on IncomingMessage)
 */
function assignTarget(req, target, data) {
  switch (target) {
    case 'body':
      req.body = data;
      break;
    case 'query':
      Object.assign(req.query, data); // getter-only — mutate in-place
      break;
    case 'params':
      Object.assign(req.params, data); // getter-only — mutate in-place
      break;
    case 'all':
      if (data.body) req.body = data.body;
      if (data.query) Object.assign(req.query, data.query); // getter-only
      if (data.params) Object.assign(req.params, data.params); // getter-only
      break;
  }
}

function formatZodErrors(error) {
  const issues = error?.issues || error?.errors || [];

  return issues.map(e => ({
    field: e.path?.join('.') ?? '',
    message: e.message,
    code: e.code,
  }));
}
