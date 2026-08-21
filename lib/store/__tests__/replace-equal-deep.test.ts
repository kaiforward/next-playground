import { describe, expect, it } from "vitest";
import { replaceEqualDeep } from "../replace-equal-deep";

describe("replaceEqualDeep", () => {
  it("returns prev verbatim when next is deep-equal", () => {
    const prev = { a: 1, b: { c: [1, 2, 3] } };
    const next = { a: 1, b: { c: [1, 2, 3] } };

    expect(replaceEqualDeep(prev, next)).toBe(prev);
  });

  it("gives a changed subtree new identity while unchanged siblings keep theirs", () => {
    const prev = { a: { x: 1 }, b: { y: 2 } };
    const next = { a: { x: 1 }, b: { y: 3 } };

    const merged = replaceEqualDeep(prev, next);

    expect(merged).not.toBe(prev);
    expect(merged.a).toBe(prev.a);
    expect(merged.b).not.toBe(prev.b);
    expect(merged.b).toEqual({ y: 3 });
  });

  it("propagates a changed subtree up through every ancestor", () => {
    const prev = { top: { mid: { leaf: 1 }, untouched: { z: 9 } } };
    const next = { top: { mid: { leaf: 2 }, untouched: { z: 9 } } };

    const merged = replaceEqualDeep(prev, next);

    expect(merged).not.toBe(prev);
    expect(merged.top).not.toBe(prev.top);
    expect(merged.top.mid).not.toBe(prev.top.mid);
    expect(merged.top.untouched).toBe(prev.top.untouched);
  });

  it("keeps array identity when every element is deep-equal", () => {
    const prev = { list: [{ id: "a" }, { id: "b" }] };
    const next = { list: [{ id: "a" }, { id: "b" }] };

    const merged = replaceEqualDeep(prev, next);

    expect(merged.list).toBe(prev.list);
  });

  it("reuses unchanged array elements while replacing a changed one", () => {
    const prev = { list: [{ id: "a" }, { id: "b" }] };
    const next = { list: [{ id: "a" }, { id: "changed" }] };

    const merged = replaceEqualDeep(prev, next);

    expect(merged.list).not.toBe(prev.list);
    expect(merged.list[0]).toBe(prev.list[0]);
    expect(merged.list[1]).not.toBe(prev.list[1]);
  });

  it("handles a key present in next but absent from prev", () => {
    const prev: { a: number; b?: number } = { a: 1 };
    const next: { a: number; b?: number } = { a: 1, b: 2 };

    const merged = replaceEqualDeep(prev, next);

    expect(merged).not.toBe(prev);
    expect(merged).toEqual({ a: 1, b: 2 });
  });

  it("treats a non-plain object (e.g. Date) as atomic — distinct instances never compare equal", () => {
    const prev = new Date(2026, 0, 1);
    const next = new Date(2026, 0, 1); // same instant, different instance

    const merged = replaceEqualDeep(prev, next);

    expect(merged).toBe(next);
    expect(merged).not.toBe(prev);
  });

  it("does not crash on null, undefined or primitives", () => {
    expect(replaceEqualDeep(null, null)).toBeNull();
    expect(replaceEqualDeep(undefined, undefined)).toBeUndefined();
    expect(replaceEqualDeep(1, 2)).toBe(2);
    expect(replaceEqualDeep("a", "a")).toBe("a");
    expect(replaceEqualDeep(null, { a: 1 })).toEqual({ a: 1 });
    expect(replaceEqualDeep({ a: 1 }, null)).toBeNull();
  });
});
