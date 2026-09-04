import { describe, expect, it } from "vitest";
import { survivalCyclesToEmpty } from "../survival-stock";

describe("survivalCyclesToEmpty", () => {
  it("returns null for an undefined stockChange", () => {
    expect(survivalCyclesToEmpty(100, undefined)).toBeNull();
  });

  it("returns null for a flat stock", () => {
    expect(survivalCyclesToEmpty(100, 0)).toBeNull();
  });

  it("returns null for a rising stock", () => {
    expect(survivalCyclesToEmpty(100, 5)).toBeNull();
  });

  it("returns stock / -stockChange for a falling stock", () => {
    expect(survivalCyclesToEmpty(100, -25)).toBe(4);
  });

  it("returns 0 for a stock already at zero and falling", () => {
    expect(survivalCyclesToEmpty(0, -1)).toBe(0);
  });
});
