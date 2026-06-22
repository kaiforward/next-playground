/**
 * Economy processor unit tests (memory-adapter, DB-free).
 *
 * Covers:
 *   1. Strike suppression: high unrest reduces post-tick stock for producers.
 *   2. Dissatisfaction signal: the returned `economySignals.dissatisfactionBySystem`
 *      reflects demand satisfaction from post-tick stock.
 *   3. Fixed-interval system shard: coverage, payload, and catch-up scaling.
 */

import { describe, it, expect } from "vitest";
import { runEconomyProcessor } from "@/lib/tick/processors/economy";
import { InMemoryEconomyWorld } from "@/lib/tick/adapters/memory/economy";
import { STRIKE_PARAMS } from "@/lib/constants/population";
import { DEFAULT_SIM_CONSTANTS } from "@/lib/engine/simulator/constants";
import { mulberry32 } from "@/lib/engine/universe-gen";
import { unitResourceVector } from "@/lib/engine/resources";
import { marketBand } from "@/lib/engine/market-pricing";
import { shardRange } from "@/lib/tick/shard";
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
  },
  modifierCaps: DEFAULT_SIM_CONSTANTS.events.modifierCaps,
  strikeParams: STRIKE_PARAMS,
};

function makeCtx(tick = 0): TickContext {
  return { tx: undefined as never, tick, results: new Map() };
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
    governmentType: "federation",
    population: 50,
    popCap: 1000,
    traits: [],
    bodyDanger: 0,
    unrest,
    buildings: { food: 2 },
    yields: unitResourceVector(),
  };
}

function makeConsumerSystem(id: string, unrest: number): SimSystem {
  return {
    id,
    name: id,
    economyType: "tech",
    regionId: "r1",
    factionId: "f1",
    governmentType: "federation",
    population: 1000,
    popCap: 2000,
    traits: [],
    bodyDanger: 0,
    unrest,
    buildings: {},
    yields: unitResourceVector(),
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
    // Mid-band: well above minStock(8) and well below maxStock(320) so the
    // direction of stock change is unambiguous regardless of production level.
    const midStock = FIXTURE_BAND.minStock + (FIXTURE_BAND.maxStock - FIXTURE_BAND.minStock) / 2;

    // Run with unrest=0 (no strike).
    const calmSystem = makeProducerSystem("sys-calm", 0);
    const calmWorld = new InMemoryEconomyWorld(
      { systems: [calmSystem], markets: [makeMarket("sys-calm", goodId, midStock)], modifiers: [] },
    );
    await runEconomyProcessor(calmWorld, makeCtx(0), { ...ECON_PARAMS, rng: mulberry32(42) });
    const calmStock = calmWorld.markets.find((m) => m.goodId === goodId)!.stock;

    // Run with unrest well above the strike threshold (0.5).
    const strikeSystem = makeProducerSystem("sys-strike", 0.9);
    const strikeWorld = new InMemoryEconomyWorld(
      { systems: [strikeSystem], markets: [makeMarket("sys-strike", goodId, midStock)], modifiers: [] },
    );
    await runEconomyProcessor(strikeWorld, makeCtx(0), { ...ECON_PARAMS, rng: mulberry32(42) });
    const strikeStock = strikeWorld.markets.find((m) => m.goodId === goodId)!.stock;

    // Production is suppressed so the struck producer accumulates less stock.
    expect(strikeStock).toBeLessThan(calmStock);
  });

  it("unrest below threshold leaves production unchanged", async () => {
    const goodId = "food";
    // Mid-band: same as above — a neutral starting point for comparing
    // unrest=0 vs unrest just below the strike threshold.
    const midStock = FIXTURE_BAND.minStock + (FIXTURE_BAND.maxStock - FIXTURE_BAND.minStock) / 2;

    const calmSystem = makeProducerSystem("sys-calm", 0);
    const calmWorld = new InMemoryEconomyWorld(
      { systems: [calmSystem], markets: [makeMarket("sys-calm", goodId, midStock)], modifiers: [] },
    );
    await runEconomyProcessor(calmWorld, makeCtx(0), { ...ECON_PARAMS, rng: mulberry32(42) });
    const calmStock = calmWorld.markets.find((m) => m.goodId === goodId)!.stock;

    // Unrest just below threshold — should behave like unrest=0.
    const belowSystem = makeProducerSystem("sys-below", STRIKE_PARAMS.threshold - 0.01);
    const belowWorld = new InMemoryEconomyWorld(
      { systems: [belowSystem], markets: [makeMarket("sys-below", goodId, midStock)], modifiers: [] },
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

// ── Fixed-interval system shard ───────────────────────────────────

describe("economy processor: fixed-interval system shard", () => {
  it("covers every system exactly once over `interval` ticks; payload reports the slice", async () => {
    const interval = 4;
    const systems = Array.from({ length: 10 }, (_, i) => makeProducerSystem(`sys-${i}`, 0));
    const sortedIds = systems.map((s) => s.id).sort((a, b) => a.localeCompare(b));
    const markets = systems.map((s) => makeMarket(s.id, "food", 100));

    const seen = new Map<string, number>();
    let totalReported = 0;
    for (let t = 0; t < interval; t++) {
      const world = new InMemoryEconomyWorld({ systems, markets, modifiers: [] });
      const result = await runEconomyProcessor(world, makeCtx(t), { ...ECON_PARAMS, interval, rng: mulberry32(1) });

      // The dissatisfaction signal is keyed by exactly the processed shard.
      const processed = [...result.economySignals!.dissatisfactionBySystem.keys()];
      const { start, end } = shardRange(sortedIds.length, t, interval);
      expect(processed.sort((a, b) => a.localeCompare(b))).toEqual(sortedIds.slice(start, end));

      const payload = result.globalEvents!.economyTick![0];
      expect(payload.shardCount).toBe(interval);
      expect(payload.shardIndex).toBe(t % interval);
      expect(payload.systemCount).toBe(processed.length);
      totalReported += payload.systemCount;
      for (const id of processed) seen.set(id, (seen.get(id) ?? 0) + 1);
    }

    // Full, disjoint coverage of the whole list across one interval.
    expect(seen.size).toBe(systems.length);
    expect([...seen.values()].every((c) => c === 1)).toBe(true);
    expect(totalReported).toBe(systems.length);
  });

  it("scales the per-update step by catchUpFactor(interval) (symmetric, equilibrium-invariant)", async () => {
    const goodId = "food";
    // A pure consumer (no production) so only the consumption term moves stock —
    // its self-limiting factor is evaluated at the identical start stock in both
    // runs, isolating the catch-up factor as the only difference.
    const start = FIXTURE_BAND.minStock + (FIXTURE_BAND.maxStock - FIXTURE_BAND.minStock) / 2;

    // interval=1 → catchUpFactor 1/24; the single system is processed at tick 0.
    const w1 = new InMemoryEconomyWorld(
      { systems: [makeConsumerSystem("c", 0)], markets: [makeMarket("c", goodId, start)], modifiers: [] },
    );
    await runEconomyProcessor(w1, makeCtx(0), { ...ECON_PARAMS, interval: 1, rng: mulberry32(7) });
    const drain1 = start - w1.markets.find((m) => m.goodId === goodId)!.stock;

    // interval=2 → catchUpFactor 2/24; the single system is processed at tick 1.
    const w2 = new InMemoryEconomyWorld(
      { systems: [makeConsumerSystem("c", 0)], markets: [makeMarket("c", goodId, start)], modifiers: [] },
    );
    await runEconomyProcessor(w2, makeCtx(1), { ...ECON_PARAMS, interval: 2, rng: mulberry32(7) });
    const drain2 = start - w2.markets.find((m) => m.goodId === goodId)!.stock;

    // Doubling the interval doubles the per-update step (catchUpFactor(2)/catchUpFactor(1) = 2).
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
   * Each system has 2 metals buildings and 50 population (= labour demand at
   * 25/building), so labourFulfillment = 1 and production is purely
   * input-gated. No ore-producing buildings are included — ore stock is set
   * directly and does not grow.
   */
  it("throttles metals production when local ore is scarce", async () => {
    // Mid-band for metals starting stock — within [minStock=8, maxStock=320].
    const MID_METALS = FIXTURE_BAND.minStock + (FIXTURE_BAND.maxStock - FIXTURE_BAND.minStock) / 2;

    function makeSmeltingSystem(id: string): SimSystem {
      return {
        id,
        name: id,
        economyType: "industrial",
        regionId: "r1",
        factionId: "f1",
        governmentType: "federation",
        population: 50, // 2 buildings × 25 labourPerUnit = exactly 50 → fulfillment = 1
        popCap: 200,
        traits: [],
        bodyDanger: 0,
        unrest: 0,
        buildings: { metals: 2 }, // smelter only — no ore extractor
        yields: unitResourceVector(),
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
