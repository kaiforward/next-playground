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

import { curveForGood, marketBand } from "../market-pricing";
import { TARGET_COVER } from "@/lib/constants/market-economy";

describe("marketBand", () => {
  it("demand sets anchor + reserve; storage inflates only the ceiling", () => {
    const b = marketBand({ demandRate: 4, storageCapacity: 0, priceFloor: 0.5, priceCeiling: 2.0 });
    expect(b.targetStock).toBeCloseTo(TARGET_COVER * 4);          // 160
    expect(b.minStock).toBeCloseTo(b.targetStock / 2.0);          // 80
    expect(b.maxStock).toBeCloseTo(b.targetStock / 0.5);          // 320
    const withStore = marketBand({ demandRate: 4, storageCapacity: 500, priceFloor: 0.5, priceCeiling: 2.0 });
    expect(withStore.maxStock).toBeCloseTo(b.maxStock + 500);     // storage adds to ceiling only
    expect(withStore.minStock).toBeCloseTo(b.minStock);           // ...not the reserve
  });
  it("maxStock > minStock structurally, even with zero storage and tiny demand", () => {
    const b = marketBand({ demandRate: 0.05, storageCapacity: 0, priceFloor: 0.5, priceCeiling: 2.0 });
    expect(b.maxStock).toBeGreaterThan(b.minStock);
  });
  it("anchorMult (active anchor_shift) scales anchor + reserve; storage term stays flat", () => {
    const base = marketBand({ demandRate: 4, storageCapacity: 100, priceFloor: 0.5, priceCeiling: 2.0 });
    const shifted = marketBand({ demandRate: 4, storageCapacity: 100, priceFloor: 0.5, priceCeiling: 2.0, anchorMult: 2 });
    expect(shifted.targetStock).toBeCloseTo(base.targetStock * 2);          // anchor doubles with the shift
    expect(shifted.minStock).toBeCloseTo(base.minStock * 2);               // reserve scales with the anchor
    expect(shifted.maxStock).toBeCloseTo(shifted.targetStock / 0.5 + 100); // demand headroom scales; +storage is flat
  });
});

describe("curveForGood", () => {
  it("anchors the curve at TARGET_COVER × demandRate (per-system reference)", () => {
    const curve = curveForGood(25, 0.5, 2.0, 3);
    expect(curve).toEqual({
      basePrice: 25,
      targetStock: TARGET_COVER * 3,
      k: 1,
      floorMult: 0.5,
      ceilingMult: 2.0,
    });
  });

  it("prices at base when stock equals the per-system reference", () => {
    const demandRate = 3;
    const curve = curveForGood(25, 0.5, 2.0, demandRate);
    expect(midPriceAt(curve, TARGET_COVER * demandRate)).toBe(25);
  });

  it("scales the reference by anchorMult", () => {
    const base = curveForGood(25, 0.5, 2.0, 3);
    const shifted = curveForGood(25, 0.5, 2.0, 3, 2);
    expect(shifted.targetStock).toBeCloseTo(base.targetStock * 2);
  });

  it("a higher demandRate gives a deeper market (higher reference)", () => {
    const thin = curveForGood(25, 0.5, 2.0, 1);
    const deep = curveForGood(25, 0.5, 2.0, 8);
    expect(deep.targetStock).toBeGreaterThan(thin.targetStock);
  });
});
