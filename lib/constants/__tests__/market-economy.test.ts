import { describe, it, expect } from "vitest";
import {
  STOCK_MIN,
  STOCK_MAX,
  TARGET_COVER,
  getSpread,
  getInitialStock,
  demandRateForGood,
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

describe("demandRateForGood", () => {
  it("returns per-capita-need × population for a populated system", () => {
    const rate = demandRateForGood("water", 1000);
    expect(rate).toBeCloseTo(GOOD_CONSUMPTION.water * 1000);
  });

  it("scales linearly with population", () => {
    const low = demandRateForGood("food", 500);
    const high = demandRateForGood("food", 1000);
    expect(high).toBeCloseTo(low * 2);
  });

  it("floors at MIN_DEMAND for a zero-population system", () => {
    expect(demandRateForGood("luxuries", 0)).toBe(MIN_DEMAND);
  });

  it("floors at MIN_DEMAND for an unknown good", () => {
    expect(demandRateForGood("not_a_good", 1000)).toBe(MIN_DEMAND);
  });
});

describe("getInitialStock", () => {
  it("seeds a net producer above its reference (deeper cover → cheap)", () => {
    // Water-rich, low-pop system: strong net water producer.
    const agg = makeResourceVector({ water: 12 });
    const reference = TARGET_COVER * demandRateForGood("water", 100);
    const seed = getInitialStock(agg, 100, "water");
    expect(seed).toBeGreaterThan(reference);
  });

  it("seeds a net consumer below its reference (shallower cover → dear)", () => {
    const agg = makeResourceVector({ water: 0 });
    const reference = TARGET_COVER * demandRateForGood("water", 2000);
    const seed = getInitialStock(agg, 2000, "water");
    expect(seed).toBeLessThan(reference);
  });

  it("a net producer seeds deeper than a net consumer at the same population", () => {
    // Same population → same reference, so the seeds compare directly: the
    // producer's deeper cover shows up as a strictly higher stock.
    const producer = getInitialStock(makeResourceVector({ water: 12 }), 500, "water");
    const consumer = getInitialStock(makeResourceVector({ water: 0 }), 500, "water");
    expect(producer).toBeGreaterThan(consumer);
  });

  it("clamps seeds to the stock band", () => {
    const seed = getInitialStock(makeResourceVector({ water: 0 }), 100000, "water");
    expect(seed).toBeGreaterThanOrEqual(STOCK_MIN);
    expect(seed).toBeLessThanOrEqual(STOCK_MAX);
  });

  it("seeds an unknown (inert) good at the stock floor", () => {
    // No production or consumption → the total===0 producerShare fallback (0.5),
    // and demandRate floors at MIN_DEMAND, so the reference (TARGET_COVER × 0.05)
    // sits below STOCK_MIN and the seed clamps up to the floor.
    expect(getInitialStock(makeResourceVector({}), 1000, "not_a_good")).toBe(STOCK_MIN);
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
