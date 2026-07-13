/**
 * Economy processor unit tests (memory-adapter, DB-free).
 *
 * Covers:
 *   1. Strike suppression: high unrest reduces post-tick stock for producers.
 *   2. Dissatisfaction signal: the returned `economySignals.dissatisfactionBySystem`
 *      reflects demand satisfaction from post-tick stock.
 *   3. Monthly pulse: the whole galaxy resolves on the boundary tick
 *      (tick % interval === 0), nothing off-boundary.
 */

import { describe, it, expect } from "vitest";
import { runEconomyProcessor } from "@/lib/tick/processors/economy";
import { InMemoryEconomyWorld } from "@/lib/tick/adapters/memory/economy";
import { STRIKE_PARAMS } from "@/lib/constants/population";
import { DEFAULT_SIM_CONSTANTS } from "@/lib/engine/simulator/constants";
import { mulberry32 } from "@/lib/engine/universe-gen";
import { unitResourceVector, emptyResourceVector } from "@/lib/engine/resources";
import { marketBand } from "@/lib/engine/market-pricing";
import type { TickContext } from "@/lib/tick/types";
import type { SimMarketEntry, SimSystem } from "@/lib/engine/simulator/types";

// Per-market band derived from the makeMarket fixture params:
//   demandRate=1, priceFloor=0.2, priceCeiling=5.0, storageCapacity=120
//   → targetStock = TARGET_COVER(40) × 1 = 40
//   → minStock    = 40 / 5.0 = 8   (scarcity reserve / price floor)
//   → maxStock    = 40 / 0.2 + 120 = 200 + 120 = 320  (infrastructure ceiling)
const FIXTURE_BAND = marketBand({ demandRate: 1, storageCapacity: 120, priceFloor: 0.2, priceCeiling: 5.0 });

// interval=1 → the whole system list is processed every tick (single shard).
// catchUpFactor(1) = 1/REFERENCE_INTERVAL scales the per-update step uniformly;
// every assertion in the strike/dissatisfaction suites is RELATIVE (one stock vs
// another under identical scaling), so the magnitude factor is immaterial here.
const ECON_PARAMS = {
  interval: 1,
  simParams: {
    noiseFraction: 0, // deterministic — no noise
    holdCover: 1.3,
  },
  modifierCaps: DEFAULT_SIM_CONSTANTS.events.modifierCaps,
  strikeParams: STRIKE_PARAMS,
};

function makeCtx(tick = 0): TickContext {
  return { tick, results: new Map() };
}

/**
 * Producer system: arable-rich, low population. Produces food, minimal consumption.
 * Consumer system: arable-barren, large population. Consumes food, no production.
 */
function makeProducerSystem(id: string, unrest: number): SimSystem {
  return {
    id,
    name: id,
    economyType: "agricultural",
    regionId: "r1",
    factionId: "f1",
    control: "developed",
    governmentType: "federation",
    population: 50,
    popCap: 1000,
    unrest,
    buildings: { food: 2 },
    buildingIdleMonths: {},
    yields: unitResourceVector(),
    slotCap: emptyResourceVector(),
    generalSpace: 0,
    habitableSpace: 0,
  };
}

function makeConsumerSystem(id: string, unrest: number): SimSystem {
  return {
    id,
    name: id,
    economyType: "tech",
    regionId: "r1",
    factionId: "f1",
    control: "developed",
    governmentType: "federation",
    population: 1000,
    popCap: 2000,
    unrest,
    buildings: {},
    buildingIdleMonths: {},
    yields: unitResourceVector(),
    slotCap: emptyResourceVector(),
    generalSpace: 0,
    habitableSpace: 0,
  };
}

function makeMarket(systemId: string, goodId: string, stock: number): SimMarketEntry {
  return {
    systemId,
    goodId,
    basePrice: 50,
    stock,
    anchorMult: 1,
    demandRate: 1,
    priceFloor: 0.2,
    priceCeiling: 5.0,
    // storageCapacity widens the per-market band's maxStock:
    //   maxStock = TARGET_COVER/priceFloor + storageCapacity = 40/0.2 + 120 = 320
    //   minStock = TARGET_COVER/priceCeiling = 40/5 = 8
    // Tests derive their stock values from FIXTURE_BAND, so they always fall
    // within this market's own [minStock, maxStock] band.
    storageCapacity: 120,
  };
}

// ── Strike suppression ────────────────────────────────────────────

describe("economy processor: strike suppression", () => {
  it("high unrest (≥ threshold) produces lower post-tick stock than unrest=0", async () => {
    const goodId = "food";
    // Active-production zone: below the operating ceiling (targetStock × holdCover = 40 × 1.3 = 52)
    // and well above the floor (minStock=8) so both production factors are positive and the
    // strike multiplier's suppression is observable.
    const prodStock = FIXTURE_BAND.targetStock - 2; // ≈ 38 — below operating ceiling

    // Run with unrest=0 (no strike).
    const calmSystem = makeProducerSystem("sys-calm", 0);
    const calmWorld = new InMemoryEconomyWorld(
      { systems: [calmSystem], markets: [makeMarket("sys-calm", goodId, prodStock)], modifiers: [] },
    );
    await runEconomyProcessor(calmWorld, makeCtx(0), { ...ECON_PARAMS, rng: mulberry32(42) });
    const calmStock = calmWorld.markets.find((m) => m.goodId === goodId)!.stock;

    // Run with unrest well above the strike threshold (0.5).
    const strikeSystem = makeProducerSystem("sys-strike", 0.9);
    const strikeWorld = new InMemoryEconomyWorld(
      { systems: [strikeSystem], markets: [makeMarket("sys-strike", goodId, prodStock)], modifiers: [] },
    );
    await runEconomyProcessor(strikeWorld, makeCtx(0), { ...ECON_PARAMS, rng: mulberry32(42) });
    const strikeStock = strikeWorld.markets.find((m) => m.goodId === goodId)!.stock;

    // Production is suppressed so the struck producer accumulates less stock.
    expect(strikeStock).toBeLessThan(calmStock);
  });

  it("unrest below threshold leaves production unchanged", async () => {
    const goodId = "food";
    // Active-production zone: below the operating ceiling (≈ 52) so production is active
    // and unrest=0 vs below-threshold unrest can be compared meaningfully.
    const prodStock = FIXTURE_BAND.targetStock - 2; // ≈ 38 — same zone as strike test above

    const calmSystem = makeProducerSystem("sys-calm", 0);
    const calmWorld = new InMemoryEconomyWorld(
      { systems: [calmSystem], markets: [makeMarket("sys-calm", goodId, prodStock)], modifiers: [] },
    );
    await runEconomyProcessor(calmWorld, makeCtx(0), { ...ECON_PARAMS, rng: mulberry32(42) });
    const calmStock = calmWorld.markets.find((m) => m.goodId === goodId)!.stock;

    // Unrest just below threshold — should behave like unrest=0.
    const belowSystem = makeProducerSystem("sys-below", STRIKE_PARAMS.threshold - 0.01);
    const belowWorld = new InMemoryEconomyWorld(
      { systems: [belowSystem], markets: [makeMarket("sys-below", goodId, prodStock)], modifiers: [] },
    );
    await runEconomyProcessor(belowWorld, makeCtx(0), { ...ECON_PARAMS, rng: mulberry32(42) });
    const belowStock = belowWorld.markets.find((m) => m.goodId === goodId)!.stock;

    // No suppression applied — both stocks should match.
    expect(belowStock).toBeCloseTo(calmStock, 5);
  });

  it("strike does NOT suppress consumption (consumers drain stock regardless)", async () => {
    const goodId = "food";
    // Near the band ceiling (maxStock=320) so the consumer has plenty to drain
    // and the assertion is not affected by stock hitting the floor mid-tick.
    const highStock = FIXTURE_BAND.maxStock - 10;

    // Consumer with unrest=0 vs unrest=0.9 — consumption should be identical.
    const calmConsumer = makeConsumerSystem("c-calm", 0);
    const calmConsWorld = new InMemoryEconomyWorld(
      { systems: [calmConsumer], markets: [makeMarket("c-calm", goodId, highStock)], modifiers: [] },
    );
    await runEconomyProcessor(calmConsWorld, makeCtx(0), { ...ECON_PARAMS, rng: mulberry32(42) });
    const calmConsStock = calmConsWorld.markets.find((m) => m.goodId === goodId)!.stock;

    const strikeConsumer = makeConsumerSystem("c-strike", 0.9);
    const strikeConsWorld = new InMemoryEconomyWorld(
      { systems: [strikeConsumer], markets: [makeMarket("c-strike", goodId, highStock)], modifiers: [] },
    );
    await runEconomyProcessor(strikeConsWorld, makeCtx(0), { ...ECON_PARAMS, rng: mulberry32(42) });
    const strikeConsStock = strikeConsWorld.markets.find((m) => m.goodId === goodId)!.stock;

    expect(strikeConsStock).toBeCloseTo(calmConsStock, 5);
  });
});

// ── Dissatisfaction signal ────────────────────────────────────────

describe("economy processor: dissatisfaction signal", () => {
  it("returns economySignals with dissatisfactionBySystem", async () => {
    const consumer = makeConsumerSystem("sys-c", 0);
    // Mid-band stock (minStock=8, maxStock=320 → mid≈164) — a neutral starting point.
    const midStock = FIXTURE_BAND.minStock + (FIXTURE_BAND.maxStock - FIXTURE_BAND.minStock) / 2;
    const world = new InMemoryEconomyWorld(
      { systems: [consumer], markets: [makeMarket("sys-c", "food", midStock)], modifiers: [] },
    );
    const result = await runEconomyProcessor(world, makeCtx(0), { ...ECON_PARAMS, rng: mulberry32(1) });
    expect(result.economySignals).toBeDefined();
    expect(result.economySignals!.dissatisfactionBySystem).toBeInstanceOf(Map);
  });

  it("D > 0 for a starved consumer system (stock pinned just above minStock)", async () => {
    const consumer = makeConsumerSystem("sys-starved", 0);
    // Pin stock just above the real per-market floor (minStock=8) so it's in
    // the low-satisfaction zone. minStock+1=9 is well inside the scarcity region.
    const world = new InMemoryEconomyWorld(
      { systems: [consumer], markets: [makeMarket("sys-starved", "food", FIXTURE_BAND.minStock + 1)], modifiers: [] },
    );
    const result = await runEconomyProcessor(world, makeCtx(0), { ...ECON_PARAMS, rng: mulberry32(1) });
    const d = result.economySignals!.dissatisfactionBySystem.get("sys-starved") ?? 0;
    expect(d).toBeGreaterThan(0);
  });

  it("D ≈ 0 for a well-fed consumer system (stock near maxStock)", async () => {
    const consumer = makeConsumerSystem("sys-fed", 0);
    // Pin stock near the per-market ceiling (maxStock=320) so satisfaction is very high.
    const world = new InMemoryEconomyWorld(
      { systems: [consumer], markets: [makeMarket("sys-fed", "food", FIXTURE_BAND.maxStock - 1)], modifiers: [] },
    );
    const result = await runEconomyProcessor(world, makeCtx(0), { ...ECON_PARAMS, rng: mulberry32(1) });
    const d = result.economySignals!.dissatisfactionBySystem.get("sys-fed") ?? 1;
    expect(d).toBeLessThan(0.1);
  });

  it("starved system has higher D than well-fed system", async () => {
    const starved = makeConsumerSystem("sys-s", 0);
    // Starved: just above minStock(8) → scarcity zone → high D.
    const starvedWorld = new InMemoryEconomyWorld(
      { systems: [starved], markets: [makeMarket("sys-s", "food", FIXTURE_BAND.minStock + 1)], modifiers: [] },
    );
    const starvedResult = await runEconomyProcessor(starvedWorld, makeCtx(0), { ...ECON_PARAMS, rng: mulberry32(1) });
    const dStarved = starvedResult.economySignals!.dissatisfactionBySystem.get("sys-s") ?? 0;

    const fed = makeConsumerSystem("sys-f", 0);
    // Fed: near maxStock(320) → abundance zone → low D.
    const fedWorld = new InMemoryEconomyWorld(
      { systems: [fed], markets: [makeMarket("sys-f", "food", FIXTURE_BAND.maxStock - 1)], modifiers: [] },
    );
    const fedResult = await runEconomyProcessor(fedWorld, makeCtx(0), { ...ECON_PARAMS, rng: mulberry32(1) });
    const dFed = fedResult.economySignals!.dissatisfactionBySystem.get("sys-f") ?? 0;

    expect(dStarved).toBeGreaterThan(dFed);
  });

  it("reports a well-supplied system (stock at the anchor) as fully content", async () => {
    // Seed stock at targetStock (=40 for demandRate=1). After the change the
    // consume factor saturates at the anchor, so post-tick stock is just slightly
    // below targetStock — satisfaction ≈ 1 → D ≈ 0. Pre-change: ceiling was maxStock
    // (320), giving factor ≈ sqrt(32/312) ≈ 0.32 at stock=40, D >> 0.05.
    const systemId = "sys-anchor";
    const consumer = makeConsumerSystem(systemId, 0);
    const world = new InMemoryEconomyWorld({
      systems: [consumer],
      markets: [makeMarket(systemId, "food", FIXTURE_BAND.targetStock)],
      modifiers: [],
    });
    const result = await runEconomyProcessor(world, makeCtx(0), { ...ECON_PARAMS, rng: mulberry32(1) });
    const d = result.economySignals?.dissatisfactionBySystem.get(systemId) ?? 1;
    expect(d).toBeLessThan(0.05); // at the anchor → content (was >> 0.05 pre-change)
  });

  it("producer system with stock near maxStock has very low D", async () => {
    // Producers also consume at per-capita rates but with small population;
    // when stock is near the per-market ceiling (maxStock=320), satisfaction
    // is near 1, so D ≈ 0.
    const producer = makeProducerSystem("sys-p", 0);
    const world = new InMemoryEconomyWorld(
      { systems: [producer], markets: [makeMarket("sys-p", "food", FIXTURE_BAND.maxStock - 1)], modifiers: [] },
    );
    const result = await runEconomyProcessor(world, makeCtx(0), { ...ECON_PARAMS, rng: mulberry32(1) });
    const d = result.economySignals!.dissatisfactionBySystem.get("sys-p") ?? 1;
    expect(d).toBeLessThan(0.05);
  });
});

// ── Monthly pulse: whole-galaxy on the boundary, empty off it ──────

describe("economy processor: monthly pulse coverage", () => {
  it("processes every system on the boundary tick and none off-boundary", async () => {
    const interval = 4; // small MONTH_LENGTH stand-in for the test
    const systems = Array.from({ length: 10 }, (_, i) => makeProducerSystem(`sys-${i}`, 0));
    const sortedIds = systems.map((s) => s.id).sort((a, b) => a.localeCompare(b));
    const markets = systems.map((s) => makeMarket(s.id, "food", 100));

    // Boundary tick (tick % interval === 0): the signal covers ALL systems.
    const wOn = new InMemoryEconomyWorld({ systems, markets, modifiers: [] });
    const onResult = await runEconomyProcessor(wOn, makeCtx(interval), { ...ECON_PARAMS, interval, rng: mulberry32(1) });
    const processed = [...onResult.economySignals!.dissatisfactionBySystem.keys()].sort((a, b) => a.localeCompare(b));
    expect(processed).toEqual(sortedIds);
    expect(onResult.globalEvents!.economyTick![0].systemCount).toBe(systems.length);

    // Off-boundary ticks: no economySignals at all (decay + population then skip).
    for (let t = 1; t < interval; t++) {
      const wOff = new InMemoryEconomyWorld({ systems, markets, modifiers: [] });
      const offResult = await runEconomyProcessor(wOff, makeCtx(t), { ...ECON_PARAMS, interval, rng: mulberry32(1) });
      expect(offResult.economySignals).toBeUndefined();
      expect(offResult.globalEvents!.economyTick![0].systemCount).toBe(0);
    }
  });

  it("interval=1 still resolves the whole list every tick (each tick is a boundary)", async () => {
    const systems = Array.from({ length: 5 }, (_, i) => makeProducerSystem(`s-${i}`, 0));
    const markets = systems.map((s) => makeMarket(s.id, "food", 100));
    const world = new InMemoryEconomyWorld({ systems, markets, modifiers: [] });
    const result = await runEconomyProcessor(world, makeCtx(3), { ...ECON_PARAMS, interval: 1, rng: mulberry32(1) });
    expect(result.economySignals!.dissatisfactionBySystem.size).toBe(systems.length);
  });

  it("scales the per-resolution step by catchUpFactor(interval) (symmetric, equilibrium-invariant)", async () => {
    const goodId = "food";
    // A pure consumer (no production) so only the consumption term moves stock —
    // its self-limiting factor is evaluated at the identical start stock in both
    // runs, isolating the catch-up factor as the only difference.
    const start = FIXTURE_BAND.minStock + (FIXTURE_BAND.maxStock - FIXTURE_BAND.minStock) / 2;

    // Both runs resolve on tick 0 — a pulse boundary for ANY interval — so the
    // whole list is processed in each. interval=1 → catchUpFactor 1/24;
    // interval=2 → catchUpFactor 2/24, exactly double the per-resolution step.
    const w1 = new InMemoryEconomyWorld(
      { systems: [makeConsumerSystem("c", 0)], markets: [makeMarket("c", goodId, start)], modifiers: [] },
    );
    await runEconomyProcessor(w1, makeCtx(0), { ...ECON_PARAMS, interval: 1, rng: mulberry32(7) });
    const drain1 = start - w1.markets.find((m) => m.goodId === goodId)!.stock;

    const w2 = new InMemoryEconomyWorld(
      { systems: [makeConsumerSystem("c", 0)], markets: [makeMarket("c", goodId, start)], modifiers: [] },
    );
    await runEconomyProcessor(w2, makeCtx(0), { ...ECON_PARAMS, interval: 2, rng: mulberry32(7) });
    const drain2 = start - w2.markets.find((m) => m.goodId === goodId)!.stock;

    // Doubling the interval doubles the per-resolution step (catchUpFactor(2)/catchUpFactor(1) = 2).
    expect(drain1).toBeGreaterThan(0);
    expect(drain2).toBeCloseTo(2 * drain1, 6);
  });
});

// ── Supply-chain input-gating (cascade) ──────────────────────────

describe("economy processor: supply-chain input-gating", () => {
  /**
   * Two smelter systems in their own worlds — identical except for ore stock.
   * Metals production requires ore (recipe: { ore: 1 }). System A has abundant
   * ore; system B has ore pinned at the floor (zero drawable). After one tick,
   * system A's metals stock must exceed system B's because the input gate is
   * wide open for A but zero for B.
   *
   * Each system has 2 metals buildings + 1 vocational_school (licenses the
   * metals buildings' skill1 demand: 2×7=14 ≪ 150, so metals isn't skill-gated)
   * and 65 population (= labour demand at 25/metals-building + 15/school), so
   * labourFulfillment = 1 and production is purely input-gated. No ore-producing
   * buildings are included — ore stock is set directly and does not grow.
   */
  it("throttles metals production when local ore is scarce", async () => {
    // Active-production zone for metals: below the operating ceiling (targetStock × 1.3 ≈ 52)
    // so production can occur when ore is available and be fully blocked when gate = 0.
    const MID_METALS = FIXTURE_BAND.minStock + 10; // ≈ 18 — well within [floor=8, ceiling≈52]

    function makeSmeltingSystem(id: string): SimSystem {
      return {
        id,
        name: id,
        economyType: "industrial",
        regionId: "r1",
        factionId: "f1",
        control: "developed",
        governmentType: "federation",
        population: 65, // 2×25 (metals) + 1×15 (vocational_school) = exactly 65 → fulfillment = 1
        popCap: 200,
        unrest: 0,
        buildings: { metals: 2, vocational_school: 1 }, // smelter + academy — no ore extractor
        buildingIdleMonths: {},
        yields: unitResourceVector(),
        slotCap: emptyResourceVector(),
        generalSpace: 0,
        habitableSpace: 0,
      };
    }

    const sysA = makeSmeltingSystem("sys-a");
    const sysB = makeSmeltingSystem("sys-b");

    const worldA = new InMemoryEconomyWorld({
      systems: [sysA],
      markets: [
        makeMarket("sys-a", "ore", FIXTURE_BAND.targetStock * 4), // ore abundant (4× targetStock): gate ≈ 1
        makeMarket("sys-a", "metals", MID_METALS),
      ],
      modifiers: [],
    });

    const worldB = new InMemoryEconomyWorld({
      systems: [sysB],
      markets: [
        makeMarket("sys-b", "ore", Math.floor(FIXTURE_BAND.minStock)), // ore at floor (drawable=0): gate = 0
        makeMarket("sys-b", "metals", MID_METALS),
      ],
      modifiers: [],
    });

    await runEconomyProcessor(worldA, makeCtx(0), { ...ECON_PARAMS, rng: mulberry32(42) });
    await runEconomyProcessor(worldB, makeCtx(0), { ...ECON_PARAMS, rng: mulberry32(42) });

    const metalsA = worldA.markets.find((m) => m.goodId === "metals")!.stock;
    const metalsB = worldB.markets.find((m) => m.goodId === "metals")!.stock;

    // Ore-rich A: ore at 4× targetStock (160), gate ≈ 1 → metals production raises stock above its start.
    // Ore-starved B: ore at floor (minStock=8, drawable=0), gate = 0 → no metals output,
    // so stock cannot rise (noise is off; it only holds flat or drains via consumption).
    expect(metalsA).toBeGreaterThan(MID_METALS);
    expect(metalsB).toBeLessThanOrEqual(MID_METALS);
    expect(metalsA).toBeGreaterThan(metalsB);
  });
});

// ── outputUptake signal ───────────────────────────────────────────

describe("economy processor: outputUptake signal", () => {
  it("emits low uptake for a producer pinned at the ceiling, high near the floor", async () => {
    const goodId = "food";
    const pinned = new InMemoryEconomyWorld({
      systems: [makeProducerSystem("p-high", 0)],
      markets: [makeMarket("p-high", goodId, FIXTURE_BAND.maxStock - 1)],
      modifiers: [],
    });
    const r1 = await runEconomyProcessor(pinned, makeCtx(0), { ...ECON_PARAMS, rng: mulberry32(1) });
    const uHigh = r1.economySignals!.outputUptakeBySystem.get("p-high")!.get(goodId)!;

    const draining = new InMemoryEconomyWorld({
      systems: [makeProducerSystem("p-low", 0)],
      markets: [makeMarket("p-low", goodId, FIXTURE_BAND.minStock + 1)],
      modifiers: [],
    });
    const r2 = await runEconomyProcessor(draining, makeCtx(0), { ...ECON_PARAMS, rng: mulberry32(1) });
    const uLow = r2.economySignals!.outputUptakeBySystem.get("p-low")!.get(goodId)!;

    expect(uHigh).toBeLessThan(0.2);
    expect(uLow).toBeGreaterThan(0.8);
    expect(uLow).toBeGreaterThan(uHigh);
  });

  it("records no uptake entry for a pure consumer (produces nothing)", async () => {
    const world = new InMemoryEconomyWorld({
      systems: [makeConsumerSystem("c", 0)],
      markets: [makeMarket("c", "food", 100)],
      modifiers: [],
    });
    const r = await runEconomyProcessor(world, makeCtx(0), { ...ECON_PARAMS, rng: mulberry32(1) });
    expect(r.economySignals!.outputUptakeBySystem.get("c")).toBeUndefined();
  });
});
