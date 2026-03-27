// =============================================================================
// asyncHandler.js — RESQID
// Wraps any async Express handler — forwards rejections to error middleware
// Eliminates try/catch boilerplate in every controller/middleware
//
// Usage:
//   export const getStudent = asyncHandler(async (req, res) => {
//     const student = await StudentService.getById(req.params.id)
//     return ApiResponse.ok(student).send(res)
//   })
// =============================================================================

/**
 * asyncHandler
 * Works for route handlers, middleware, and error middleware (4-arg)
 * @param {Function} fn - async function (req, res, next) or (err, req, res, next)
 * @returns {Function}  - wrapped function that catches rejections
 */

export const asyncHandler = fn => {
  // Preserve arity — Express uses fn.length to detect error middleware (4 args)
  if (fn.length === 4) {
    // Error middleware: (err, req, res, next)
    return function asyncErrorMiddleware(err, req, res, next) {
      Promise.resolve(fn(err, req, res, next)).catch(next);
    };
  }

  // Regular middleware/handler: (req, res, next)
  return function asyncMiddleware(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
