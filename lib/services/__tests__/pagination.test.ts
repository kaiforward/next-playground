import { describe, it, expect } from "vitest";
import { buildPaginatedArgs, paginateResults } from "../pagination";

// ── buildPaginatedArgs ────────────────────────────────────────

describe("buildPaginatedArgs", () => {
  it("uses default limit of 30 and takes limit+1", () => {
    const args = buildPaginatedArgs({}, {}, "createdAt", "desc");
    expect(args.take).toBe(31);
    expect(args.orderBy).toEqual({ createdAt: "desc" });
    expect(args.cursor).toBeUndefined();
    expect(args.skip).toBeUndefined();
  });

  it("respects custom limit", () => {
    const args = buildPaginatedArgs({ limit: 10 }, {}, "createdAt", "desc");
    expect(args.take).toBe(11);
  });

  it("clamps limit to max 100", () => {
    const args = buildPaginatedArgs({ limit: 200 }, {}, "createdAt", "desc");
    expect(args.take).toBe(101);
  });

  it("clamps limit to min 1", () => {
    const args = buildPaginatedArgs({ limit: 0 }, {}, "createdAt", "desc");
    expect(args.take).toBe(2);
  });

  it("sets cursor and skip when cursor is provided", () => {
    const args = buildPaginatedArgs({ cursor: "abc-123" }, {}, "createdAt", "desc");
    expect(args.cursor).toEqual({ id: "abc-123" });
    expect(args.skip).toBe(1);
  });

  it("uses provided sort field and order", () => {
    const args = buildPaginatedArgs(
      { sort: "name", order: "asc" },
      {},
      "createdAt",
      "desc",
    );
    expect(args.orderBy).toEqual({ name: "asc" });
  });

  it("falls back to defaults when sort/order not provided", () => {
    const args = buildPaginatedArgs({}, {}, "updatedAt", "asc");
    expect(args.orderBy).toEqual({ updatedAt: "asc" });
  });

  it("passes through baseWhere as the where clause", () => {
    const baseWhere = { playerId: "p1", type: { in: ["a", "b"] } };
    const args = buildPaginatedArgs({}, baseWhere, "createdAt", "desc");
    expect(args.where).toEqual(baseWhere);
  });

  it("does not mutate the baseWhere object", () => {
    const baseWhere = { playerId: "p1" };
    const original = { ...baseWhere };
    buildPaginatedArgs({ cursor: "c1" }, baseWhere, "createdAt", "desc");
    expect(baseWhere).toEqual(original);
  });
});

// ── paginateResults ───────────────────────────────────────────

describe("paginateResults", () => {
  const makeRows = (count: number) =>
    Array.from({ length: count }, (_, i) => ({ id: `id-${i}`, name: `item-${i}` }));

  it("returns all items and null cursor when rows <= limit", () => {
    const rows = makeRows(5);
    const result = paginateResults(rows, 5, 10);
    expect(result.items).toHaveLength(5);
    expect(result.nextCursor).toBeNull();
    expect(result.total).toBe(5);
  });

  it("returns items equal to limit when rows === limit", () => {
    const rows = makeRows(10);
    const result = paginateResults(rows, 10, 10);
    expect(result.items).toHaveLength(10);
    expect(result.nextCursor).toBeNull();
  });

  it("slices to limit and returns cursor when rows > limit", () => {
    const rows = makeRows(11); // limit+1 rows fetched
    const result = paginateResults(rows, 25, 10);
    expect(result.items).toHaveLength(10);
    expect(result.nextCursor).toBe("id-9"); // last item of sliced array
    expect(result.total).toBe(25);
  });

  it("returns empty items and null cursor for empty rows", () => {
    const result = paginateResults([], 0, 10);
    expect(result.items).toHaveLength(0);
    expect(result.nextCursor).toBeNull();
    expect(result.total).toBe(0);
  });

  it("handles single row correctly", () => {
    const rows = makeRows(1);
    const result = paginateResults(rows, 1, 10);
    expect(result.items).toHaveLength(1);
    expect(result.nextCursor).toBeNull();
    expect(result.total).toBe(1);
  });

  it("preserves item data in the output", () => {
    const rows = [{ id: "x", name: "test-item" }];
    const result = paginateResults(rows, 1, 10);
    expect(result.items[0]).toEqual({ id: "x", name: "test-item" });
  });
});
