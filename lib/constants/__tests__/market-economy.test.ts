import { describe, it, expect } from "vitest";
import {
  STOCK_MIN,
  STOCK_MAX,
  TARGET_COVER,
  getSpread,
  getInitialStock,
  demandRateForGood,
  totalDemandRateForGood,
  MIN_DEMAND,
  demandFootprint,
} from "../market-economy";
import { GOVERNMENT_TYPES } from "../government";
import { GOOD_CONSUMPTION } from "@/lib/constants/physical-economy";
import { inputDemandForGood } from "@/lib/engine/industry";
import { unitResourceVector } from "@/lib/engine/resources";

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

describe("totalDemandRateForGood", () => {
  it("equals civilian demand when no buildings consume the good", () => {
    expect(totalDemandRateForGood("ore", 1000, {}, 1, unitResourceVector())).toBeCloseTo(demandRateForGood("ore", 1000), 6);
  });

  it("adds the production-input draw on top of civilian demand", () => {
    // 10 metals buildings draw ore (recipe { ore: 1 }) → a non-zero industrial term.
    const buildings = { metals: 10 };
    const industrial = inputDemandForGood(buildings, "ore", 1, unitResourceVector());
    expect(industrial).toBeGreaterThan(0);
    const total = totalDemandRateForGood("ore", 1000, buildings, 1, unitResourceVector());
    expect(total).toBeCloseTo(demandRateForGood("ore", 1000) + industrial, 6);
    expect(total).toBeGreaterThan(demandRateForGood("ore", 1000));
  });

  it("floors at MIN_DEMAND when both civilian and industrial demand are zero", () => {
    expect(totalDemandRateForGood("not_a_good", 0, {}, 1, unitResourceVector())).toBe(MIN_DEMAND);
  });
});

describe("getInitialStock", () => {
  it("seeds a net producer above its reference (deeper cover → cheap)", () => {
    // A system with water extractors (unit yields) producing more water than its
    // small population consumes: a strong net water producer.
    const buildings = { water: 20 };
    const yields = unitResourceVector();
    const reference = TARGET_COVER * demandRateForGood("water", 100);
    const seed = getInitialStock(buildings, yields, 100, "water");
    expect(seed).toBeGreaterThan(reference);
  });

  it("seeds a net consumer below its reference (shallower cover → dear)", () => {
    // No water extractors + high population → pure consumer.
    const buildings = {};
    const yields = unitResourceVector();
    const reference = TARGET_COVER * demandRateForGood("water", 2000);
    const seed = getInitialStock(buildings, yields, 2000, "water");
    expect(seed).toBeLessThan(reference);
  });

  it("a net producer seeds deeper than a net consumer at the same population", () => {
    // Same population → same reference, so the seeds compare directly: the
    // producer's deeper cover shows up as a strictly higher stock.
    const yields = unitResourceVector();
    const producer = getInitialStock({ water: 20 }, yields, 500, "water");
    const consumer = getInitialStock({}, yields, 500, "water");
    expect(producer).toBeGreaterThan(consumer);
  });

  it("higher yields lift a producer's stock (more production → deeper cover)", () => {
    // Same extractor count, richer deposit (higher yieldMult) → more production.
    const buildings = { water: 8 };
    const lean = getInitialStock(buildings, { ...unitResourceVector(), water: 1 }, 800, "water");
    const rich = getInitialStock(buildings, { ...unitResourceVector(), water: 4 }, 800, "water");
    expect(rich).toBeGreaterThanOrEqual(lean);
  });

  it("clamps seeds to the stock band", () => {
    const seed = getInitialStock({}, unitResourceVector(), 100000, "water");
    expect(seed).toBeGreaterThanOrEqual(STOCK_MIN);
    expect(seed).toBeLessThanOrEqual(STOCK_MAX);
  });

  it("seeds an unknown (inert) good at the stock floor", () => {
    // No production or consumption → the total===0 producerShare fallback (0.5),
    // and demandRate floors at MIN_DEMAND, so the reference (TARGET_COVER × 0.05)
    // sits below STOCK_MIN and the seed clamps up to the floor.
    expect(getInitialStock({}, unitResourceVector(), 1000, "not_a_good")).toBe(STOCK_MIN);
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

describe("demandFootprint", () => {
  it("lists consumed goods descending by demand, scaled by population", () => {
    const f = demandFootprint(10_000);
    expect(f.length).toBeGreaterThan(0);
    for (let i = 1; i < f.length; i++) {
      expect(f[i - 1].demandRate).toBeGreaterThanOrEqual(f[i].demandRate);
    }
    expect(f[0].demandRate).toBeCloseTo(demandRateForGood(f[0].goodId, 10_000), 6);
    // water/food carry the highest per-capita need (0.004), so they lead at scale.
    expect(["water", "food"]).toContain(f[0].goodId);
  });
  it("floors every good at MIN_DEMAND for a zero population", () => {
    expect(demandFootprint(0).every((e) => e.demandRate === MIN_DEMAND)).toBe(true);
  });
});
