// =============================================================================
// paginate.js — RESQID
// Two pagination strategies:
//   offset — simple page/limit (admin dashboards, reports)
//   cursor — high-performance infinite scroll (parent app scan history)
//
// Always use cursor for large tables (ScanLog, AuditLog, Notification)
// Use offset for small tables with known size (Students, Tokens per school)
// =============================================================================

// ─── Constants ────────────────────────────────────────────────────────────────
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const DEFAULT_CURSOR = null;

// ─── Offset Pagination ────────────────────────────────────────────────────────

/**
 * parseOffsetParams(query)
 * Parses and validates pagination params from request query
 * @returns {{ skip: number, take: number, page: number, limit: number }}
 */
export function parseOffsetParams(query) {
  const page = Math.max(1, parseInt(query.page ?? 1, 10));
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, parseInt(query.limit ?? DEFAULT_LIMIT, 10)),
  );

  return {
    page,
    limit,
    skip: (page - 1) * limit,
    take: limit,
  };
}

/**
 * buildOffsetMeta(total, page, limit)
 * Builds the meta block for paginated responses
 */
export function buildOffsetMeta(total, page, limit) {
  const totalPages = Math.ceil(total / limit);
  return {
    total,
    page,
    limit,
    totalPages,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
  };
}

/**
 * paginateOffset(prismaModel, { where, select, orderBy }, query)
 * All-in-one Prisma offset paginator
 *
 * @example
 * const result = await paginateOffset(
 *   prisma.student,
 *   { where: { school_id }, orderBy: { created_at: 'desc' } },
 *   req.query
 * )
 * return ApiResponse.paginated(result.data, result.meta).send(res)
 */
export async function paginateOffset(model, args, query) {
  const { page, limit, skip, take } = parseOffsetParams(query);

  const [data, total] = await Promise.all([
    model.findMany({ ...args, skip, take }),
    model.count({ where: args.where }),
  ]);

  return {
    data,
    meta: buildOffsetMeta(total, page, limit),
  };
}

// ─── Cursor Pagination ────────────────────────────────────────────────────────

/**
 * parseCursorParams(query)
 * @returns {{ cursor: string|null, take: number, direction: 'forward'|'backward' }}
 */
export function parseCursorParams(query) {
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, parseInt(query.limit ?? DEFAULT_LIMIT, 10)),
  );
  const cursor = query.cursor ?? DEFAULT_CURSOR;
  const direction = query.direction === "backward" ? "backward" : "forward";

  return { cursor, take: limit, limit, direction };
}

/**
 * paginateCursor(prismaModel, { where, select, orderBy, cursorField }, query)
 * High-performance cursor pagination for large append-only tables
 * Always sorted by ID or created_at — stable ordering guaranteed
 *
 * @example
 * const result = await paginateCursor(
 *   prisma.scanLog,
 *   { where: { token_id }, orderBy: { created_at: 'desc' }, cursorField: 'id' },
 *   req.query
 * )
 */
export async function paginateCursor(model, args, query) {
  const { cursor, take, limit } = parseCursorParams(query);
  const cursorField = args.cursorField ?? "id";

  // Fetch one extra to determine if next page exists
  const queryArgs = {
    where: args.where,
    select: args.select,
    orderBy: args.orderBy ?? { created_at: "desc" },
    take: take + 1,
    ...(cursor && {
      cursor: { [cursorField]: cursor },
      skip: 1, // skip the cursor item itself
    }),
  };

  const rows = await model.findMany(queryArgs);
  const hasMore = rows.length > take;

  if (hasMore) rows.pop(); // remove the extra row

  const nextCursor = hasMore
    ? (rows[rows.length - 1]?.[cursorField] ?? null)
    : null;
  const prevCursor = cursor ? (rows[0]?.[cursorField] ?? null) : null;

  return {
    data: rows,
    meta: {
      limit,
      hasNextPage: hasMore,
      hasPrevPage: !!cursor,
      nextCursor,
      prevCursor,
    },
  };
}
