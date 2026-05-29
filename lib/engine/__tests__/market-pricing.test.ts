import { describe, it, expect } from "vitest";
import { midPriceAt, spotPrice, type MarketCurve } from "../market-pricing";

// Wide clamp so the raw curve is visible (legacy-style 0.2x–5.0x).
const WIDE: MarketCurve = {
  basePrice: 100,
  targetStock: 20,
  k: 1,
  floorMult: 0.2,
  ceilingMult: 5.0,
};

// Tier-0-style narrow clamp (0.5x–2.0x) to exercise floor/ceiling.
const NARROW: MarketCurve = {
  basePrice: 100,
  targetStock: 20,
  k: 1,
  floorMult: 0.5,
  ceilingMult: 2.0,
};

describe("midPriceAt", () => {
  it("returns basePrice when stock equals targetStock", () => {
    expect(midPriceAt(WIDE, 20)).toBe(100);
  });

  it("is more expensive when stock is below target (shortage)", () => {
    expect(midPriceAt(WIDE, 10)).toBe(200); // 100 * 20/10
  });

  it("is cheaper when stock is above target (surplus)", () => {
    expect(midPriceAt(WIDE, 40)).toBe(50); // 100 * 20/40
  });

  it("clamps to the ceiling on severe shortage", () => {
    // raw 100 * 20/5 = 400, clamped to 2.0 * 100 = 200
    expect(midPriceAt(NARROW, 5)).toBe(200);
  });

  it("clamps to the floor on severe surplus", () => {
    // raw 100 * 20/80 = 25, clamped up to 0.5 * 100 = 50
    expect(midPriceAt(NARROW, 80)).toBe(50);
  });

  it("returns the ceiling when stock is zero or negative", () => {
    expect(midPriceAt(WIDE, 0)).toBe(500); // 5.0 * 100
    expect(midPriceAt(WIDE, -3)).toBe(500);
  });

  it("defaults k to 1 when omitted", () => {
    const noK: MarketCurve = { basePrice: 100, targetStock: 20, floorMult: 0.2, ceilingMult: 5.0 };
    expect(midPriceAt(noK, 10)).toBe(200);
  });

  it("softens the curve when k < 1", () => {
    // 100 * (20/10)^0.5 = 100 * 1.41421 = 141.42, gentler than k=1's 200
    const soft: MarketCurve = { ...WIDE, k: 0.5 };
    expect(midPriceAt(soft, 10)).toBeCloseTo(141.42, 1);
    expect(midPriceAt(soft, 10)).toBeLessThan(midPriceAt(WIDE, 10));
  });
});

describe("spotPrice", () => {
  it("rounds the mid price for display", () => {
    // 100 * 20/30 = 66.667 -> 67
    expect(spotPrice(WIDE, 30)).toBe(67);
  });
});
