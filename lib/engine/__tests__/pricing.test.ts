import { describe, it, expect } from "vitest";
import { calculatePrice } from "../pricing";

describe("calculatePrice", () => {
  it("returns base price when supply equals demand", () => {
    const price = calculatePrice(100, 50, 50);
    expect(price).toBe(100);
  });

  it("returns higher price when demand > supply", () => {
    const price = calculatePrice(100, 50, 100);
    expect(price).toBe(200);
  });

  it("returns lower price when supply > demand", () => {
    const price = calculatePrice(100, 100, 50);
    expect(price).toBe(50);
  });

  it("clamps to max 5x base price", () => {
    // demand/supply ratio = 10, so raw = 1000, clamped to 500
    const price = calculatePrice(100, 10, 100);
    expect(price).toBe(500);
  });

  it("clamps to min 0.2x base price", () => {
    // demand/supply ratio = 0.05, so raw = 5, clamped to 20
    const price = calculatePrice(100, 100, 5);
    expect(price).toBe(20);
  });

  it("returns max price when supply is 0", () => {
    const price = calculatePrice(100, 0, 50);
    expect(price).toBe(500);
  });

  it("returns max price when supply is negative", () => {
    const price = calculatePrice(100, -10, 50);
    expect(price).toBe(500);
  });
});
