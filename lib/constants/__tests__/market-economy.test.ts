import { describe, it, expect } from "vitest";
import {
  STOCK_MIN,
  STOCK_MAX,
  getSpread,
  marketDemandRate,
  MIN_DEMAND,
} from "../market-economy";
import { GOVERNMENT_TYPES } from "../government";
import { GOOD_CONSUMPTION } from "@/lib/constants/physical-economy";
import { makeResourceVector } from "@/lib/engine/resources";

describe("stock bounds", () => {
  it("reuses the legacy supply band", () => {
    expect(STOCK_MIN).toBe(5);
    expect(STOCK_MAX).toBe(200);
  });
});

describe("marketDemandRate", () => {
  it("returns per-capita-need × population for a populated system", () => {
    const rate = marketDemandRate(makeResourceVector({}), 1000, "water");
    expect(rate).toBeCloseTo(GOOD_CONSUMPTION.water * 1000);
  });

  it("scales linearly with population", () => {
    const low = marketDemandRate(makeResourceVector({}), 500, "food");
    const high = marketDemandRate(makeResourceVector({}), 1000, "food");
    expect(high).toBeCloseTo(low * 2);
  });

  it("floors at MIN_DEMAND for a zero-population system", () => {
    expect(marketDemandRate(makeResourceVector({}), 0, "luxuries")).toBe(MIN_DEMAND);
  });

  it("floors at MIN_DEMAND for an unknown good", () => {
    expect(marketDemandRate(makeResourceVector({}), 1000, "not_a_good")).toBe(MIN_DEMAND);
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
