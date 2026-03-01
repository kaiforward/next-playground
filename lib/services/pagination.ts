/**
 * Shared pagination helpers for Prisma cursor-based pagination.
 *
 * Usage:
 *   const args = buildPaginatedArgs(params, baseWhere, "createdAt", "desc");
 *   const [rows, total] = await Promise.all([
 *     prisma.model.findMany({ ...args, select: { ... } }),
 *     prisma.model.count({ where: args.where }),
 *   ]);
 *   return paginateResults(rows, total, args.take - 1);
 */

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

interface PaginationParams {
  cursor?: string;
  limit?: number;
  sort?: string;
  order?: "asc" | "desc";
}

interface PaginatedArgs<W = Record<string, unknown>> {
  where: W;
  orderBy: Record<string, "asc" | "desc">;
  take: number;
  skip?: number;
  cursor?: { id: string };
}

export interface PaginatedResult<T> {
  items: T[];
  nextCursor: string | null;
  total: number;
}

/**
 * Build Prisma `findMany` args from standard pagination params.
 * Uses Prisma native cursor pagination: `cursor: { id }, skip: 1`.
 *
 * @param params    - Pagination query params (cursor, limit, sort, order)
 * @param baseWhere - Entity-specific where clause (filters, search, etc.)
 * @param defaultSort  - Default sort field when `params.sort` is not provided
 * @param defaultOrder - Default sort direction when `params.order` is not provided
 */
export function buildPaginatedArgs<W extends Record<string, unknown> = Record<string, unknown>>(
  params: PaginationParams,
  baseWhere: W,
  defaultSort: string,
  defaultOrder: "asc" | "desc",
): PaginatedArgs<W> {
  const limit = Math.min(Math.max(params.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const sortField = params.sort ?? defaultSort;
  const order = params.order ?? defaultOrder;

  const args: PaginatedArgs<W> = {
    where: baseWhere,
    orderBy: { [sortField]: order },
    take: limit + 1, // fetch one extra to detect next page
  };

  if (params.cursor) {
    args.cursor = { id: params.cursor };
    args.skip = 1; // skip the cursor item itself
  }

  return args;
}

/**
 * Slice `limit+1` rows down to `limit`, compute `nextCursor`.
 *
 * @param rows  - Rows returned from `findMany` (up to `limit + 1`)
 * @param total - Total matching count from `count()` query
 * @param limit - The actual page size (NOT the `take` value — pass `args.take - 1`)
 */
export function paginateResults<T extends { id: string }>(
  rows: T[],
  total: number,
  limit: number,
): PaginatedResult<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore && items.length > 0
    ? items[items.length - 1].id
    : null;

  return { items, nextCursor, total };
}
