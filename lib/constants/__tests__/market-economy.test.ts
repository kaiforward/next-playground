import { describe, it, expect } from "vitest";
import {
  TARGET_COVER,
  getInitialStock,
  civilianDemandRateForGood,
  totalDemandRateForGood,
  MIN_DEMAND,
  SEED_COVER_MIN,
  SEED_COVER_MAX,
  INITIAL_RESERVE_ANCHOR_FRAC,
} from "../market-economy";
import { GOOD_CONSUMPTION } from "@/lib/constants/physical-economy";
import {
  inputDemandForGood,
  facilityStorageForGood,
  computeSystemLabourSnapshot,
  buildingProduction,
} from "@/lib/engine/industry";
import type { LabourState } from "@/lib/engine/industry";
import { consumptionRate } from "@/lib/engine/physical-economy";
import type { CivilianDemandBasis } from "@/lib/engine/physical-economy";
import { unitResourceVector } from "@/lib/engine/resources";
import { marketBand } from "@/lib/engine/market-pricing";
import { GOODS } from "@/lib/constants/goods";

/** A fully-staffed labour state — headcount and both skill ceilings unconstrained. */
const FULL: LabourState = { labourFulfil: 1, skill1Fulfil: 1, skill2Fulfil: 1 };

/** A demand basis with no skilled work — population is the only demand driver. */
const popOnly = (population: number): CivilianDemandBasis => ({
  population,
  technicians: 0,
  engineers: 0,
});

describe("civilianDemandRateForGood", () => {
  it("returns per-capita-need × population for a populated system", () => {
    const rate = civilianDemandRateForGood("water", popOnly(1000));
    expect(rate).toBeCloseTo(GOOD_CONSUMPTION.water * 1000);
  });

  it("scales linearly with population", () => {
    const low = civilianDemandRateForGood("food", popOnly(500));
    const high = civilianDemandRateForGood("food", popOnly(1000));
    expect(high).toBeCloseTo(low * 2);
  });

  it("floors at MIN_DEMAND for a zero-population system", () => {
    expect(civilianDemandRateForGood("luxuries", popOnly(0))).toBe(MIN_DEMAND);
  });

  it("floors at MIN_DEMAND for an unknown good", () => {
    expect(civilianDemandRateForGood("not_a_good", popOnly(1000))).toBe(MIN_DEMAND);
  });
});

describe("civilianDemandRateForGood with skilled work", () => {
  it("skilled heads raise basket-good demand above the population-only rate", () => {
    const flat = civilianDemandRateForGood("luxuries", popOnly(1000));
    const skilled = civilianDemandRateForGood("luxuries", { population: 1000, technicians: 150, engineers: 40 });
    expect(skilled).toBeGreaterThan(flat);
  });

  it("non-basket goods are unchanged by skilled work", () => {
    const flat = civilianDemandRateForGood("food", popOnly(1000));
    const skilled = civilianDemandRateForGood("food", { population: 1000, technicians: 150, engineers: 40 });
    expect(skilled).toBeCloseTo(flat, 10);
  });
});

describe("totalDemandRateForGood", () => {
  it("equals civilian demand when no buildings consume the good", () => {
    expect(totalDemandRateForGood("ore", popOnly(1000), {}, unitResourceVector())).toBeCloseTo(civilianDemandRateForGood("ore", popOnly(1000)), 6);
  });

  it("adds the production-input draw on top of civilian demand", () => {
    // 10 metals buildings draw ore (recipe { ore: 1 }) → a non-zero industrial term.
    // metals is skill1-gated (tier 1); a vocational_school licenses the skill1 pool
    // so this system's real (computeLabourState-derived) state is fully staffed,
    // matching FULL — otherwise totalDemandRateForGood's internal skill gate would
    // zero the forecast out from under this test.
    const buildings = { metals: 10, vocational_school: 1 };
    const industrial = inputDemandForGood(buildings, "ore", FULL, unitResourceVector());
    expect(industrial).toBeGreaterThan(0);
    const total = totalDemandRateForGood("ore", popOnly(1000), buildings, unitResourceVector());
    expect(total).toBeCloseTo(civilianDemandRateForGood("ore", popOnly(1000)) + industrial, 6);
    expect(total).toBeGreaterThan(civilianDemandRateForGood("ore", popOnly(1000)));
  });

  it("floors at MIN_DEMAND when both civilian and industrial demand are zero", () => {
    expect(totalDemandRateForGood("not_a_good", popOnly(0), {}, unitResourceVector())).toBe(MIN_DEMAND);
  });
});

describe("getInitialStock", () => {
  it("seeds a net producer above its reference (deeper cover → cheap)", () => {
    // A system with water extractors (unit yields) producing more water than its
    // small population consumes: a strong net water producer.
    const buildings = { water: 20 };
    const yields = unitResourceVector();
    const reference = TARGET_COVER * civilianDemandRateForGood("water", popOnly(100));
    const seed = getInitialStock(buildings, yields, 100, "water");
    expect(seed).toBeGreaterThan(reference);
  });

  it("seeds a net consumer below its reference (shallower cover → dear)", () => {
    // No water extractors + high population → pure consumer.
    const buildings = {};
    const yields = unitResourceVector();
    const reference = TARGET_COVER * civilianDemandRateForGood("water", popOnly(2000));
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

  it("clamps seeds to the per-market band (not the global STOCK_MIN/MAX)", () => {
    // A pure consumer at large population: seed is within the per-market band,
    // which is much wider than the old global [STOCK_MIN, STOCK_MAX].
    const pop = 100000, good = "water";
    const g = GOODS[good];
    const band = marketBand({
      demandRate: civilianDemandRateForGood(good, popOnly(pop)),
      storageCapacity: facilityStorageForGood({}, good),
      priceFloor: g.priceFloor, priceCeiling: g.priceCeiling,
    });
    const seed = getInitialStock({}, unitResourceVector(), pop, good);
    expect(seed).toBeGreaterThanOrEqual(Math.floor(band.minStock));
    expect(seed).toBeLessThanOrEqual(Math.ceil(band.maxStock));
  });

  it("seeds an unknown (inert) good within its per-market band", () => {
    // No production or consumption → total===0, producerShare fallback = 0.5,
    // demandRate = MIN_DEMAND=0.05. Fallback band: priceFloor=0.5, priceCeiling=2.0,
    // storageCapacity=0 → targetStock=2, minStock=1, maxStock=4.
    // coverMult = 0.5+0.5*(1.5-0.5)=1.0 → seed = max(1,min(4,2*1)) = 2.
    const seed = getInitialStock({}, unitResourceVector(), 1000, "not_a_good");
    expect(seed).toBeGreaterThanOrEqual(1);
    expect(seed).toBeLessThanOrEqual(4);
  });

  it("seeds within the per-market band; producer deeper than consumer", () => {
    const pop = 800, good = "ore", producer = { ore: 6 }, consumer = {};
    const g = GOODS[good];
    const band = marketBand({
      demandRate: civilianDemandRateForGood(good, popOnly(pop)),
      storageCapacity: facilityStorageForGood(producer, good),
      priceFloor: g.priceFloor, priceCeiling: g.priceCeiling,
    });
    const seedProducer = getInitialStock(producer, unitResourceVector(), pop, good);
    const seedConsumer = getInitialStock(consumer, unitResourceVector(), pop, good);
    expect(seedProducer).toBeGreaterThanOrEqual(Math.floor(band.minStock));
    expect(seedProducer).toBeLessThanOrEqual(Math.ceil(band.maxStock));
    expect(seedProducer).toBeGreaterThan(seedConsumer); // producer is deeper-stocked (cheaper)
  });

  it("seeds a pure consumer at the separate initial-reserve floor", () => {
    // Pure consumer (no buildings) → producerShare=0 → raw coverMult=SEED_COVER_MIN (0.5).
    // The separate 0.75 × targetStock initial-reserve policy binds,
    // not the old minStock (the price-saturation point, targetStock/priceCeiling = 0.5×targetStock too,
    // but for a different reason — this asserts the initial reserve is what actually binds now).
    const pop = 1000, good = "water";
    const g = GOODS[good];
    const band = marketBand({
      demandRate: civilianDemandRateForGood(good, popOnly(pop)),
      storageCapacity: facilityStorageForGood({}, good),
      priceFloor: g.priceFloor, priceCeiling: g.priceCeiling,
    });
    const seed = getInitialStock({}, unitResourceVector(), pop, good);
    expect(seed).toBeCloseTo(INITIAL_RESERVE_ANCHOR_FRAC * band.targetStock, 6);
  });

  it("still seeds a pure producer at deep cover (coverMult unchanged, comfort floor doesn't bind)", () => {
    // A strong net water producer (20 extractors, modest population): production dwarfs
    // consumption, so producerShare is high and the raw coverMult sits well above the
    // The initial-reserve floor (0.75) only lifts a shallow consumer seed,
    // never touches a producer's already-deep one.
    const buildings = { water: 20 };
    const yields = unitResourceVector();
    const pop = 100;
    const good = "water";
    const g = GOODS[good];

    const snap = computeSystemLabourSnapshot(buildings, pop);
    const production = buildingProduction(buildings, good, snap.state, yields);
    const consumption = consumptionRate(good, snap.basis);
    const total = production + consumption;
    const producerShare = total > 0 ? production / total : 0.5;
    const coverMult = SEED_COVER_MIN + producerShare * (SEED_COVER_MAX - SEED_COVER_MIN);

    const band = marketBand({
      demandRate: civilianDemandRateForGood(good, popOnly(pop)),
      storageCapacity: facilityStorageForGood(buildings, good),
      priceFloor: g.priceFloor, priceCeiling: g.priceCeiling,
    });
    const expectedSeed = Math.min(band.maxStock, band.targetStock * coverMult);

    const seed = getInitialStock(buildings, yields, pop, good);
    expect(coverMult).toBeGreaterThan(INITIAL_RESERVE_ANCHOR_FRAC);
    expect(seed).toBeCloseTo(expectedSeed, 6);
  });
});
