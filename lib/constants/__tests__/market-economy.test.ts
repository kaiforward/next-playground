import { describe, it, expect } from "vitest";
import {
  STOCK_MIN,
  STOCK_MAX,
  getTargetStock,
  getInitialStock,
  getSpread,
  marketDemandRate,
  MIN_DEMAND,
} from "../market-economy";
import { GOVERNMENT_TYPES } from "../government";
import { GOODS } from "../goods";
import { GOOD_CONSUMPTION } from "@/lib/constants/physical-economy";
import { makeResourceVector } from "@/lib/engine/resources";

describe("stock bounds", () => {
  it("reuses the legacy supply band", () => {
    expect(STOCK_MIN).toBe(5);
    expect(STOCK_MAX).toBe(200);
  });
});

describe("getTargetStock", () => {
  it("returns the measured anchor for every good", () => {
    // Universal consumption means every good settles at its own level (no
    // neutral markets to hold the average up), so all twelve are pinned to
    // their simulator-measured equilibrium rather than the supply-band midpoint.
    expect(getTargetStock("water")).toBe(122);
    expect(getTargetStock("food")).toBe(101);
    expect(getTargetStock("luxuries")).toBe(39);
  });

  it("falls back to the mid stock band for unknown goods", () => {
    expect(getTargetStock("not_a_good")).toBe(Math.round((STOCK_MIN + STOCK_MAX) / 2));
  });
});

describe("getInitialStock", () => {
  it("seeds a net producer high (toward produces -> cheap)", () => {
    // Water-rich, low-pop system: strong net water producer.
    const seed = getInitialStock(makeResourceVector({ water: 12 }), 100, "water");
    expect(seed).toBeGreaterThan(getTargetStock("water"));
    expect(seed).toBeLessThanOrEqual(GOODS.water.equilibrium.produces);
  });

  it("seeds a net consumer low (toward consumes -> dear)", () => {
    // Water-barren, populous system: pure net water consumer.
    const consumerSeed = getInitialStock(makeResourceVector({ water: 0 }), 2000, "water");
    const producerSeed = getInitialStock(makeResourceVector({ water: 12 }), 100, "water");
    expect(consumerSeed).toBe(GOODS.water.equilibrium.consumes);
    expect(consumerSeed).toBeLessThan(producerSeed);
  });

  it("seeds at the target when the system has no production or consumption", () => {
    // Zero population -> no rates on either axis -> the pricing anchor.
    expect(getInitialStock(makeResourceVector({ water: 12 }), 0, "water")).toBe(getTargetStock("water"));
  });

  it("seeds an unknown good at its target", () => {
    expect(getInitialStock(makeResourceVector({}), 1000, "not_a_good")).toBe(getTargetStock("not_a_good"));
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
