import { describe, it, expect } from "vitest";
import {
  STOCK_MIN,
  STOCK_MAX,
  getTargetStock,
  getInitialStock,
  getSpread,
} from "../market-economy";
import { GOVERNMENT_TYPES } from "../government";

describe("stock bounds", () => {
  it("reuses the legacy supply band", () => {
    expect(STOCK_MIN).toBe(5);
    expect(STOCK_MAX).toBe(200);
  });
});

describe("getTargetStock", () => {
  it("is the midpoint of the good's producer and consumer supply targets", () => {
    // water: produces.supply 160, consumes.supply 110 -> round((160+110)/2)=135
    expect(getTargetStock("water")).toBe(135);
    // luxuries: 38, 24 -> 31
    expect(getTargetStock("luxuries")).toBe(31);
  });

  it("falls back to the mid stock band for unknown goods", () => {
    expect(getTargetStock("not_a_good")).toBe(Math.round((STOCK_MIN + STOCK_MAX) / 2));
  });
});

describe("getInitialStock", () => {
  it("seeds producers high (above target -> cheap)", () => {
    // agricultural produces food (produces.supply 155)
    expect(getInitialStock("agricultural", "food")).toBe(155);
    expect(getInitialStock("agricultural", "food")).toBeGreaterThan(getTargetStock("food"));
  });

  it("seeds consumers below target (-> expensive), blended by self-sufficiency", () => {
    // tech consumes food (self-sufficiency 0.15) -> between consumes.supply(110) and produces.supply(155)
    const stock = getInitialStock("tech", "food");
    expect(stock).toBeLessThan(getTargetStock("food"));
    expect(stock).toBeGreaterThanOrEqual(110);
  });

  it("seeds neutral goods at the target (-> price == base)", () => {
    // a good the economy neither produces nor consumes resolves to targetStock
    expect(getInitialStock("agricultural", "weapons")).toBe(getTargetStock("weapons"));
  });
});

describe("getSpread", () => {
  it("returns the default half-spread with no government", () => {
    expect(getSpread()).toBe(0.05);
  });

  it("widens for frontier and tightens for authoritarian", () => {
    const frontier = getSpread(GOVERNMENT_TYPES.frontier); // +20% -> 0.06
    const auth = getSpread(GOVERNMENT_TYPES.authoritarian); // -15% -> 0.0425
    expect(frontier).toBeCloseTo(0.06, 5);
    expect(auth).toBeCloseTo(0.0425, 5);
    expect(frontier).toBeGreaterThan(auth);
  });
});
