/**
 * Economy processor unit tests (memory-adapter, DB-free).
 *
 * Covers:
 *   1. Strike suppression: high unrest reduces post-tick stock for producers.
 *   2. Dissatisfaction signal: the returned `economySignals.dissatisfactionBySystem`
 *      reflects demand satisfaction from post-tick stock.
 *   3. Cycle start: the whole galaxy resolves on the boundary tick
 *      (tick % interval === 0), nothing off-boundary.
 */

import { describe, it, expect, vi } from "vitest";
import { runEconomyProcessor } from "@/lib/tick/processors/economy";
import { InMemoryEconomyWorld } from "@/lib/tick/adapters/memory/economy";
import type { MarketUpdate, MarketView } from "@/lib/tick/world/economy-world";
import type { ModifierRow } from "@/lib/engine/events";
import { STRIKE_PARAMS } from "@/lib/constants/population";
import { strikeMultiplier } from "@/lib/engine/population";
import { SHORTAGE_SATISFACTION } from "@/lib/constants/economy";
import { MODIFIER_CAPS } from "@/lib/constants/events";
import { REFERENCE_INTERVAL } from "@/lib/constants/tick-cadence";
import { unitResourceVector, emptyResourceVector } from "@/lib/engine/resources";
import { marketBandForRow } from "@/lib/engine/market-pricing";
import { brakeKnee } from "@/lib/engine/tick";
import { buildingProduction, computeSystemLabourSnapshot } from "@/lib/engine/industry";
import { GOODS } from "@/lib/constants/goods";
import type { EconomySignals, TickContext } from "@/lib/tick/types";
import type { TickSystem } from "@/lib/tick/rows";
import type { WorldMarket } from "@/lib/world/types";

// The band the processor itself resolves for the makeMarket fixture — same
// GOODS lookup it does internally, so the stock values below sit where the test
// intends rather than outside the real band.
//   demandRate=1, storageCapacity=120; GOODS.food priceFloor=0.5, priceCeiling=2.0
//   → targetStock = TARGET_COVER(40) × 1 = 40
//   → minStock    = 40 / 2.0 = 20   (scarcity reserve / price floor)
//   → maxStock    = 40 / 0.5 + 120 = 80 + 120 = 200  (infrastructure ceiling)
const FIXTURE_BAND = marketBandForRow({ demandRate: 1, storageCapacity: 120 }, GOODS.food);

// interval=1 → the whole system list is processed every tick (single shard).
// catchUpFactor(1) = 1/REFERENCE_INTERVAL scales the per-update step uniformly;
// every assertion in the strike/dissatisfaction suites is RELATIVE (one stock vs
// another under identical scaling), so the magnitude factor is immaterial here.
const ECON_PARAMS = {
  interval: 1,
  simParams: {
    brakeUseCover: 40,
    brakeRamp: 1.3,
    brakeOutputCover: 8,
    rationCover: 2,
  },
  modifierCaps: MODIFIER_CAPS,
  strikeParams: STRIKE_PARAMS,
};

function makeCtx(tick = 0): TickContext {
  return { tick, results: new Map() };
}

function requireEconomySignals(signals: EconomySignals | undefined): EconomySignals {
  if (signals === undefined) throw new Error("Expected economy signals");
  return signals;
}

function requireSellingFactor(
  signals: EconomySignals | undefined,
  systemId: string,
  goodId: string,
): number {
  const byGood = requireEconomySignals(signals).sellingFactorBySystem.get(systemId);
  if (byGood === undefined) throw new Error(`Expected selling factors for ${systemId}`);
  const factor = byGood.get(goodId);
  if (factor === undefined) throw new Error(`Expected ${goodId} selling factor for ${systemId}`);
  return factor;
}

/**
 * Producer system: arable-rich, low population. Produces food, minimal consumption.
 * Consumer system: arable-barren, large population. Consumes food, no production.
 */
function makeProducerSystem(id: string, unrest: number): TickSystem {
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
    buildingIdleCycles: {},
    collapseDebt: 0,
    yields: unitResourceVector(),
    extractionEff: unitResourceVector(),
    depositCounts: emptyResourceVector(),
    peopleLand: 0,
  };
}

function makeConsumerSystem(id: string, unrest: number): TickSystem {
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
    buildingIdleCycles: {},
    collapseDebt: 0,
    yields: unitResourceVector(),
    extractionEff: unitResourceVector(),
    depositCounts: emptyResourceVector(),
    peopleLand: 0,
  };
}

function makeMarket(systemId: string, goodId: string, stock: number): WorldMarket {
  return {
    systemId,
    goodId,
    stock,
    anchorMult: 1,
    demandRate: 1,
    // The persisted use figure — the brake knee's warehousing denominator. 1 puts the
    // knee's use term at brakeUseCover × 1 = 40, so any active-production fixture stock
    // below 40 sits in the full-rate zone whatever the fixture's output term computes to.
    honestUseRate: 1,
    // storageCapacity widens the per-market band's maxStock:
    //   maxStock = TARGET_COVER/priceFloor + storageCapacity = 40/0.5 + 120 = 200
    //   minStock = TARGET_COVER/priceCeiling = 40/2 = 20
    // Tests derive their stock values from FIXTURE_BAND, so they always fall
    // within this market's own [minStock, maxStock] band.
    storageCapacity: 120,
  };
}

// The brake knee the processor derives for the producer fixture's food market — computed
// from the same primitives the adapter feeds it (the row's use figure, buildingProduction
// as capacity), so geometry probe stocks always sit where each test intends whatever
// OUTPUT_PER_UNIT resolves to.
const PRODUCER_BUILDINGS = { food: 2 }; // makeProducerSystem's built base
const FOOD_CAPACITY = buildingProduction(
  PRODUCER_BUILDINGS,
  "food",
  computeSystemLabourSnapshot(PRODUCER_BUILDINGS, 50).state, // makeProducerSystem's population
  unitResourceVector(),
);
const FIXTURE_KNEE = brakeKnee(
  { useRate: 1, capacityProduction: FOOD_CAPACITY, anchorMult: 1 },
  ECON_PARAMS.simParams,
);
const KNEE_MID = (FIXTURE_KNEE.knee + FIXTURE_KNEE.rampEnd) / 2;

// ── Strike suppression ────────────────────────────────────────────

describe("economy processor: strike suppression", () => {
  it("high unrest (≥ threshold) produces lower post-tick stock than unrest=0", async () => {
    const goodId = "food";
    // Active-production zone: below the brake knee (≥ brakeUseCover × honestUseRate 1 = 40)
    // and well above the floor (minStock=20) so both production factors are positive and the
    // strike multiplier's suppression is observable.
    const prodStock = FIXTURE_BAND.targetStock - 2; // ≈ 38 — inside the full-rate zone

    // Run with unrest=0 (no strike).
    const calmSystem = makeProducerSystem("sys-calm", 0);
    const calmWorld = new InMemoryEconomyWorld(
      { systems: [calmSystem], markets: [makeMarket("sys-calm", goodId, prodStock)], modifiers: [] },
    );
    await runEconomyProcessor(calmWorld, makeCtx(0), { ...ECON_PARAMS });
    const calmStock = calmWorld.markets.find((m) => m.goodId === goodId)!.stock;

    // Run with unrest well above the strike threshold (0.5).
    const strikeSystem = makeProducerSystem("sys-strike", 0.9);
    const strikeWorld = new InMemoryEconomyWorld(
      { systems: [strikeSystem], markets: [makeMarket("sys-strike", goodId, prodStock)], modifiers: [] },
    );
    await runEconomyProcessor(strikeWorld, makeCtx(0), { ...ECON_PARAMS });
    const strikeStock = strikeWorld.markets.find((m) => m.goodId === goodId)!.stock;

    // Production is suppressed so the struck producer accumulates less stock.
    expect(strikeStock).toBeLessThan(calmStock);
  });

  it("unrest below threshold leaves production unchanged", async () => {
    const goodId = "food";
    // Active-production zone: below the brake knee (≥ 40) so production is active
    // and unrest=0 vs below-threshold unrest can be compared meaningfully.
    const prodStock = FIXTURE_BAND.targetStock - 2; // ≈ 38 — same zone as strike test above

    const calmSystem = makeProducerSystem("sys-calm", 0);
    const calmWorld = new InMemoryEconomyWorld(
      { systems: [calmSystem], markets: [makeMarket("sys-calm", goodId, prodStock)], modifiers: [] },
    );
    await runEconomyProcessor(calmWorld, makeCtx(0), { ...ECON_PARAMS });
    const calmStock = calmWorld.markets.find((m) => m.goodId === goodId)!.stock;

    // Unrest just below threshold — should behave like unrest=0.
    const belowSystem = makeProducerSystem("sys-below", STRIKE_PARAMS.threshold - 0.01);
    const belowWorld = new InMemoryEconomyWorld(
      { systems: [belowSystem], markets: [makeMarket("sys-below", goodId, prodStock)], modifiers: [] },
    );
    await runEconomyProcessor(belowWorld, makeCtx(0), { ...ECON_PARAMS });
    const belowStock = belowWorld.markets.find((m) => m.goodId === goodId)!.stock;

    // No suppression applied — both stocks should match.
    expect(belowStock).toBeCloseTo(calmStock, 5);
  });

  it("strike does NOT suppress consumption (consumers drain stock regardless)", async () => {
    const goodId = "food";
    // Near the band ceiling (maxStock=200) so the consumer has plenty to drain
    // and the assertion is not affected by stock hitting the floor mid-tick.
    const highStock = FIXTURE_BAND.maxStock - 10;

    // Consumer with unrest=0 vs unrest=0.9 — consumption should be identical.
    const calmConsumer = makeConsumerSystem("c-calm", 0);
    const calmConsWorld = new InMemoryEconomyWorld(
      { systems: [calmConsumer], markets: [makeMarket("c-calm", goodId, highStock)], modifiers: [] },
    );
    await runEconomyProcessor(calmConsWorld, makeCtx(0), { ...ECON_PARAMS });
    const calmConsStock = calmConsWorld.markets.find((m) => m.goodId === goodId)!.stock;

    const strikeConsumer = makeConsumerSystem("c-strike", 0.9);
    const strikeConsWorld = new InMemoryEconomyWorld(
      { systems: [strikeConsumer], markets: [makeMarket("c-strike", goodId, highStock)], modifiers: [] },
    );
    await runEconomyProcessor(strikeConsWorld, makeCtx(0), { ...ECON_PARAMS });
    const strikeConsStock = strikeConsWorld.markets.find((m) => m.goodId === goodId)!.stock;

    expect(strikeConsStock).toBeCloseTo(calmConsStock, 5);
  });
});

// ── Dissatisfaction signal ────────────────────────────────────────

describe("economy processor: dissatisfaction signal", () => {
  it("returns economySignals with dissatisfactionBySystem", async () => {
    const consumer = makeConsumerSystem("sys-c", 0);
    // Mid-band stock (minStock=20, maxStock=200 → mid=110) — a neutral starting point.
    const midStock = FIXTURE_BAND.minStock + (FIXTURE_BAND.maxStock - FIXTURE_BAND.minStock) / 2;
    const world = new InMemoryEconomyWorld(
      { systems: [consumer], markets: [makeMarket("sys-c", "food", midStock)], modifiers: [] },
    );
    const result = await runEconomyProcessor(world, makeCtx(0), { ...ECON_PARAMS });
    expect(result.economySignals).toBeDefined();
    expect(result.economySignals!.dissatisfactionBySystem).toBeInstanceOf(Map);
  });

  it("D > 0 for a consumer inside the emergency ration zone", async () => {
    const consumer = makeConsumerSystem("sys-starved", 0);
    // Pin stock just above the real per-market floor (minStock=20) so it's in
    // the low-satisfaction zone. minStock+1=21 is well inside the scarcity region.
    const world = new InMemoryEconomyWorld(
      { systems: [consumer], markets: [makeMarket("sys-starved", "food", 0.5)], modifiers: [] },
    );
    const result = await runEconomyProcessor(world, makeCtx(0), { ...ECON_PARAMS });
    const d = result.economySignals!.dissatisfactionBySystem.get("sys-starved") ?? 0;
    expect(d).toBeGreaterThan(0);
  });

  it("D ≈ 0 for a well-fed consumer system (stock near maxStock)", async () => {
    const consumer = makeConsumerSystem("sys-fed", 0);
    // Pin stock near the per-market ceiling (maxStock=200) so satisfaction is very high.
    const world = new InMemoryEconomyWorld(
      { systems: [consumer], markets: [makeMarket("sys-fed", "food", FIXTURE_BAND.maxStock - 1)], modifiers: [] },
    );
    const result = await runEconomyProcessor(world, makeCtx(0), { ...ECON_PARAMS });
    const d = result.economySignals!.dissatisfactionBySystem.get("sys-fed") ?? 1;
    expect(d).toBeLessThan(0.1);
  });

  it("starved system has higher D than well-fed system", async () => {
    const starved = makeConsumerSystem("sys-s", 0);
    // Starved: just above minStock(20) → scarcity zone → high D.
    const starvedWorld = new InMemoryEconomyWorld(
      { systems: [starved], markets: [makeMarket("sys-s", "food", 0.5)], modifiers: [] },
    );
    const starvedResult = await runEconomyProcessor(starvedWorld, makeCtx(0), { ...ECON_PARAMS });
    const dStarved = starvedResult.economySignals!.dissatisfactionBySystem.get("sys-s") ?? 0;

    const fed = makeConsumerSystem("sys-f", 0);
    // Fed: near maxStock(200) → abundance zone → low D.
    const fedWorld = new InMemoryEconomyWorld(
      { systems: [fed], markets: [makeMarket("sys-f", "food", FIXTURE_BAND.maxStock - 1)], modifiers: [] },
    );
    const fedResult = await runEconomyProcessor(fedWorld, makeCtx(0), { ...ECON_PARAMS });
    const dFed = fedResult.economySignals!.dissatisfactionBySystem.get("sys-f") ?? 0;

    expect(dStarved).toBeGreaterThan(dFed);
  });

  it("reports a well-supplied system (stock at the anchor) as fully content", async () => {
    // Seed stock at targetStock (=40 for demandRate=1). The consume factor
    // saturates at the anchor, so post-tick stock is just slightly below
    // targetStock — satisfaction ≈ 1 → D ≈ 0.
    const systemId = "sys-anchor";
    const consumer = makeConsumerSystem(systemId, 0);
    const world = new InMemoryEconomyWorld({
      systems: [consumer],
      markets: [makeMarket(systemId, "food", FIXTURE_BAND.targetStock)],
      modifiers: [],
    });
    const result = await runEconomyProcessor(world, makeCtx(0), { ...ECON_PARAMS });
    const d = result.economySignals?.dissatisfactionBySystem.get(systemId) ?? 1;
    expect(d).toBeLessThan(0.05); // at the anchor → content (was >> 0.05 pre-change)
  });

  it("producer system with stock near maxStock has very low D", async () => {
    // Producers also consume at per-capita rates but with small population;
    // when stock is near the per-market ceiling (maxStock=200), satisfaction
    // is near 1, so D ≈ 0.
    const producer = makeProducerSystem("sys-p", 0);
    const world = new InMemoryEconomyWorld(
      { systems: [producer], markets: [makeMarket("sys-p", "food", FIXTURE_BAND.maxStock - 1)], modifiers: [] },
    );
    const result = await runEconomyProcessor(world, makeCtx(0), { ...ECON_PARAMS });
    const d = result.economySignals!.dissatisfactionBySystem.get("sys-p") ?? 1;
    expect(d).toBeLessThan(0.05);
  });
});

// ── Supply regime signal ──────────────────────────────────────────

describe("economy processor: supply regime signal", () => {
  // rationCover × demandRate = 2 × 1 = 2 is the ration knee; below it the delivered
  // fraction is √(stock / 2), so these stocks pin an exact satisfaction:
  //   100    → ≥ knee  → 1     (fully served)
  //   1.28   → √0.64   → 0.8   (short of full, above the shortage line)
  //   0.405  → √0.2025 → 0.45  (just below the shortage line, mildly)
  //   0.125  → √0.0625 → 0.25  (well below the shortage line, deeply)
  const SERVED_STOCK = 100;
  const RATIONED_STOCK = 1.28;
  const MILD_SHORT_STOCK = 0.405;
  const SHORT_STOCK = 0.125;
  /** An absolute-scale reference only, at the retired escalation cut's old magnitude — used below to
   *  pin that a fixture's dissatisfaction reads "mild" rather than "near-total collapse". Not tied to
   *  any live mechanism boundary (the escalation ramp it once gated is gone). */
  const MILD_D_REFERENCE = 0.65;

  const regimeOf = (signals: EconomySignals | undefined, systemId: string) =>
    requireEconomySignals(signals).supplyStateBySystem.get(systemId)?.regime;
  const stateOf = (signals: EconomySignals | undefined, systemId: string) =>
    requireEconomySignals(signals).supplyStateBySystem.get(systemId);
  const dOf = (signals: EconomySignals | undefined, systemId: string) =>
    requireEconomySignals(signals).dissatisfactionBySystem.get(systemId);
  const satOf = (world: InMemoryEconomyWorld, goodId: string) =>
    world.markets.find((m) => m.goodId === goodId)!.satisfaction;

  it("reads supplied when every demanded good is served in full", async () => {
    const world = new InMemoryEconomyWorld({
      systems: [makeConsumerSystem("sys-fed", 0)],
      markets: [makeMarket("sys-fed", "food", SERVED_STOCK), makeMarket("sys-fed", "water", SERVED_STOCK)],
      modifiers: [],
    });
    const result = await runEconomyProcessor(world, makeCtx(0), { ...ECON_PARAMS });
    expect(satOf(world, "food")).toBe(1);
    expect(satOf(world, "water")).toBe(1);
    expect(regimeOf(result.economySignals, "sys-fed")).toBe("supplied");
  });

  it("reads strained when one demanded good is short of full but Provision still reads healthy", async () => {
    const world = new InMemoryEconomyWorld({
      systems: [makeConsumerSystem("sys-short", 0)],
      markets: [makeMarket("sys-short", "food", SERVED_STOCK), makeMarket("sys-short", "water", RATIONED_STOCK)],
      modifiers: [],
    });
    const result = await runEconomyProcessor(world, makeCtx(0), { ...ECON_PARAMS });
    // Water at 0.8 with food fully served folds to Provision ≈ 0.89 — inside [RATIONING_PROVISION,
    // SUPPLIED_PROVISION), not the exact-zero-D cliff the old three-band fold required for anything
    // above "supplied". This fixture is exactly the case the redesign exists for: served, but not
    // fully, no longer means "rationing" outright.
    expect(satOf(world, "water")).toBeCloseTo(0.8, 6);
    expect(regimeOf(result.economySignals, "sys-short")).toBe("strained");
  });

  it("reads famine when one demanded good falls below the survival line", async () => {
    const world = new InMemoryEconomyWorld({
      systems: [makeConsumerSystem("sys-starved", 0)],
      markets: [makeMarket("sys-starved", "food", SERVED_STOCK), makeMarket("sys-starved", "water", SHORT_STOCK)],
      modifiers: [],
    });
    const result = await runEconomyProcessor(world, makeCtx(0), { ...ECON_PARAMS });
    // A deep water shortage drives Famine through the survival floor alone — the next test
    // isolates the floor from a milder depth; "stops at deprived for a near-total basket collapse"
    // (population-analysis.test.ts) is the other side, where a whole-basket collapse that never
    // crosses the survival line stays on the Provision axis rather than reaching Famine.
    expect(satOf(world, "water")).toBeCloseTo(0.25, 6);
    expect(dOf(result.economySignals, "sys-starved")).toBeLessThan(MILD_D_REFERENCE);
    expect(regimeOf(result.economySignals, "sys-starved")).toBe("famine");
  });

  it("promotes to famine from the survival floor alone, with D mild", async () => {
    // The floor's whole reason to exist: water just under the survival line is famine even though the
    // fold alone reads it as mild. Without hasSurvivalShortfall this fixture reads "rationing", so it
    // fails if the floor is removed — which the deep-shortage case above cannot detect.
    // Water and food alone (both necessity 1.0) already carry >50% of the necessity-weighted basket's
    // total weight under the un-squared fold, so a water shortfall deep enough to trip the survival
    // line (satisfaction < 0.5) would also drive D well past MILD_D_REFERENCE on its own — that would
    // no longer isolate the floor from a genuinely large shortfall. Three more fully-served goods
    // (medicine, gas, textiles) dilute water's share enough that D stays mild while the floor still
    // fires.
    const world = new InMemoryEconomyWorld({
      systems: [makeConsumerSystem("sys-thirsty", 0)],
      markets: [
        makeMarket("sys-thirsty", "food", SERVED_STOCK),
        makeMarket("sys-thirsty", "water", MILD_SHORT_STOCK),
        makeMarket("sys-thirsty", "medicine", SERVED_STOCK),
        makeMarket("sys-thirsty", "gas", SERVED_STOCK),
        makeMarket("sys-thirsty", "textiles", SERVED_STOCK),
      ],
      modifiers: [],
    });
    const result = await runEconomyProcessor(world, makeCtx(0), { ...ECON_PARAMS });
    expect(satOf(world, "water")).toBeCloseTo(0.45, 6);
    expect(satOf(world, "water")).toBeLessThan(SHORTAGE_SATISFACTION); // below the survival line
    expect(dOf(result.economySignals, "sys-thirsty")).toBeLessThan(MILD_D_REFERENCE); // but D is mild
    expect(stateOf(result.economySignals, "sys-thirsty")).toEqual({
      regime: "famine",
      survivalShortfall: true,
      criticalWeight: 0, // every demanded good here sits above CRITICAL_SATISFACTION
      emptyBasket: false, // multiple demanded goods carry real weight
    });
  });

  it("reads supplied for a producer with no local consumption", async () => {
    // Population 0 → nothing is demanded locally, so even a market pinned below the
    // survival line rations nobody. Stock deep in the starvation zone is what makes this
    // discriminating: were demand not suppressed, this system would read famine.
    const world = new InMemoryEconomyWorld({
      systems: [{ ...makeProducerSystem("sys-pureprod", 0), population: 0 }],
      markets: [makeMarket("sys-pureprod", "food", SHORT_STOCK)],
      modifiers: [],
    });
    const result = await runEconomyProcessor(world, makeCtx(0), { ...ECON_PARAMS });
    expect(result.economySignals!.dissatisfactionBySystem.get("sys-pureprod")).toBe(0);
    expect(regimeOf(result.economySignals, "sys-pureprod")).toBe("supplied");
  });
});

// ── Cycle start: whole-galaxy on the boundary, empty off it ──────

describe("economy processor: cycle start coverage", () => {
  it("processes every system on the boundary tick and none off-boundary", async () => {
    const interval = 4; // small CYCLE_LENGTH stand-in for the test
    const systems = Array.from({ length: 10 }, (_, i) => makeProducerSystem(`sys-${i}`, 0));
    const sortedIds = systems.map((s) => s.id).sort((a, b) => a.localeCompare(b));
    const markets = systems.map((s) => makeMarket(s.id, "food", 100));

    // Boundary tick (tick % interval === 0): the signal covers ALL systems.
    const wOn = new InMemoryEconomyWorld({ systems, markets, modifiers: [] });
    const onResult = await runEconomyProcessor(wOn, makeCtx(interval), { ...ECON_PARAMS, interval });
    const processed = [...onResult.economySignals!.dissatisfactionBySystem.keys()].sort((a, b) => a.localeCompare(b));
    expect(processed).toEqual(sortedIds);
    expect(onResult.globalEvents!.economyTick![0].systemCount).toBe(systems.length);

    // Off-boundary ticks: no economySignals at all (decay + population then skip).
    for (let t = 1; t < interval; t++) {
      const wOff = new InMemoryEconomyWorld({ systems, markets, modifiers: [] });
      const offResult = await runEconomyProcessor(wOff, makeCtx(t), { ...ECON_PARAMS, interval });
      expect(offResult.economySignals).toBeUndefined();
      expect(offResult.globalEvents!.economyTick![0].systemCount).toBe(0);
    }
  });

  it("interval=1 still resolves the whole list every tick (each tick is a boundary)", async () => {
    const systems = Array.from({ length: 5 }, (_, i) => makeProducerSystem(`s-${i}`, 0));
    const markets = systems.map((s) => makeMarket(s.id, "food", 100));
    const world = new InMemoryEconomyWorld({ systems, markets, modifiers: [] });
    const result = await runEconomyProcessor(world, makeCtx(3), { ...ECON_PARAMS, interval: 1 });
    expect(result.economySignals!.dissatisfactionBySystem.size).toBe(systems.length);
  });

  it("scales the per-resolution step by catchUpFactor(interval) (symmetric, equilibrium-invariant)", async () => {
    const goodId = "food";
    // A pure consumer (no production) so only the consumption term moves stock —
    // its self-limiting factor is evaluated at the identical start stock in both
    // runs, isolating the catch-up factor as the only difference.
    const start = FIXTURE_BAND.minStock + (FIXTURE_BAND.maxStock - FIXTURE_BAND.minStock) / 2;

    // Both runs resolve on tick 0 — a cycle boundary for ANY interval — so the
    // whole list is processed in each. interval=1 → catchUpFactor 1/24;
    // interval=2 → catchUpFactor 2/24, exactly double the per-resolution step.
    const w1 = new InMemoryEconomyWorld(
      { systems: [makeConsumerSystem("c", 0)], markets: [makeMarket("c", goodId, start)], modifiers: [] },
    );
    await runEconomyProcessor(w1, makeCtx(0), { ...ECON_PARAMS, interval: 1 });
    const drain1 = start - w1.markets.find((m) => m.goodId === goodId)!.stock;

    const w2 = new InMemoryEconomyWorld(
      { systems: [makeConsumerSystem("c", 0)], markets: [makeMarket("c", goodId, start)], modifiers: [] },
    );
    await runEconomyProcessor(w2, makeCtx(0), { ...ECON_PARAMS, interval: 2 });
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
   * labourFulfilment = 1 and production is purely input-gated. No ore-producing
   * buildings are included — ore stock is set directly and does not grow.
   */
  it("throttles metals production when local ore is scarce", async () => {
    // Active-production zone for metals: below the brake knee (≥ brakeUseCover ×
    // honestUseRate 1 = 40) so production can occur when ore is available and be
    // fully blocked when gate = 0. FIXTURE_BAND just supplies a convenient scalar.
    const MID_METALS = FIXTURE_BAND.minStock + 10; // 30 — inside the full-rate zone

    function makeSmeltingSystem(id: string): TickSystem {
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
        buildingIdleCycles: {},
        collapseDebt: 0,
        yields: unitResourceVector(),
        extractionEff: unitResourceVector(),
        depositCounts: emptyResourceVector(),
        peopleLand: 0,
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
        makeMarket("sys-b", "ore", 0.5),
        makeMarket("sys-b", "metals", MID_METALS),
      ],
      modifiers: [],
    });

    const resultA = await runEconomyProcessor(worldA, makeCtx(0), { ...ECON_PARAMS });
    const resultB = await runEconomyProcessor(worldB, makeCtx(0), { ...ECON_PARAMS });

    const metalsA = worldA.markets.find((m) => m.goodId === "metals")!.stock;
    const metalsB = worldB.markets.find((m) => m.goodId === "metals")!.stock;

    // Ore-rich A sits far above its ration threshold, gate = 1 →
    // metals production raises stock well above its start.
    // Ore-starved B sits inside the emergency ration zone, so the
    // shared scarcity ramp throttles the draw — metals still produces a little (no hard
    // floor zeroing it) but far less than A, so A ends higher than B.
    expect(metalsA).toBeGreaterThan(MID_METALS);
    expect(metalsB).toBeGreaterThan(MID_METALS); // scarce ore still produces on the ramp
    expect(metalsA).toBeGreaterThan(metalsB); // but scarce ore throttles output below abundant
    expect(requireSellingFactor(resultA.economySignals, "sys-a", "metals")).toBeCloseTo(
      requireSellingFactor(resultB.economySignals, "sys-b", "metals"),
    );
  });
});

// ── selling factor signal ───────────────────────────────────────────

describe("economy processor: realised production signal", () => {
  it("exports realised production per (system, good) in economySignals", async () => {
    const systems = [makeProducerSystem("sys-1", 0)];
    // Active-production zone (below the brake knee, ≥ 40) — same reasoning as the
    // strike-suppression tests above. Stock at the fixture's default 100 sits past
    // the ramp end and yields zero output.
    const markets = [makeMarket("sys-1", "food", FIXTURE_BAND.targetStock - 2)];
    const world = new InMemoryEconomyWorld({ systems, markets, modifiers: [] });
    const result = await runEconomyProcessor(world, makeCtx(0), { ...ECON_PARAMS });
    const realised = result.economySignals!.realisedProductionBySystem;
    expect(realised.get("sys-1")).toBeDefined();
    expect(realised.get("sys-1")!.get("food")).toBeGreaterThan(0);
  });

  it("records no realised entry for a pure consumer (produces nothing)", async () => {
    const world = new InMemoryEconomyWorld({
      systems: [makeConsumerSystem("c", 0)],
      markets: [makeMarket("c", "food", 100)],
      modifiers: [],
    });
    const r = await runEconomyProcessor(world, makeCtx(0), { ...ECON_PARAMS });
    expect(r.economySignals!.realisedProductionBySystem.get("c")).toBeUndefined();
  });
});

describe("economy processor: selling factor signal", () => {
  it("emits the production-knee geometry from start stock", async () => {
    // Probes derived from the fixture's own computed knee: at the knee full rate, at the
    // taper midpoint half, at the ramp end zero — the same shape the retired anchor brake
    // had, now anchored on the use figure and capacity instead of targetStock.
    const stocks = [FIXTURE_KNEE.knee, KNEE_MID, FIXTURE_KNEE.rampEnd];
    const expected = [1, 0.5, 0];
    for (let index = 0; index < stocks.length; index++) {
      const id = `p-${index}`;
      const world = new InMemoryEconomyWorld({
        systems: [makeProducerSystem(id, 0)],
        markets: [makeMarket(id, "food", stocks[index])],
        modifiers: [],
      });
      const result = await runEconomyProcessor(world, makeCtx(0), { ...ECON_PARAMS });
      expect(requireSellingFactor(result.economySignals, id, "food")).toBeCloseTo(expected[index]);
    }
  });

  it("uses start stock even when the cycle materially changes final stock", async () => {
    const world = new InMemoryEconomyWorld({
      systems: [makeProducerSystem("p", 0)],
      markets: [makeMarket("p", "food", FIXTURE_KNEE.knee)],
      modifiers: [],
    });
    const result = await runEconomyProcessor(world, makeCtx(0), {
      ...ECON_PARAMS,
      interval: 24,
    });
    expect(world.markets[0].stock).not.toBe(FIXTURE_KNEE.knee);
    expect(requireSellingFactor(result.economySignals, "p", "food")).toBe(1);
  });

  it("keeps the knee cadence-invariant — the same start state yields the same factor at any interval", async () => {
    // The knee's output denominator must be the reference-cycle rate: fed the catch-up-scaled
    // entry.productionRate instead, a finer cadence would shrink the knee and re-brake the same
    // physical state. An output-bound market (an explicit zero use figure) exposes exactly that —
    // the general cadence-invariance sim stays green through this fault because its braked
    // markets are use-term-bound, so this probe is the premise's only cheap failing test.
    const outputKnee = brakeKnee(
      { useRate: 0, capacityProduction: FOOD_CAPACITY, anchorMult: 1 },
      ECON_PARAMS.simParams,
    );
    const probe = (outputKnee.knee + outputKnee.rampEnd) / 2;
    const factors: number[] = [];
    for (const interval of [12, 24]) {
      const world = new InMemoryEconomyWorld({
        systems: [makeProducerSystem("p", 0)],
        markets: [{ ...makeMarket("p", "food", probe), honestUseRate: 0 }],
        modifiers: [],
      });
      const result = await runEconomyProcessor(world, makeCtx(0), { ...ECON_PARAMS, interval });
      factors.push(requireSellingFactor(result.economySignals, "p", "food"));
    }
    expect(factors[0]).toBeCloseTo(0.5, 6);
    expect(factors[1]).toBeCloseTo(factors[0], 9);
  });

  it("is invariant to strike and maintenance flow suppression", async () => {
    // capacityProduction is the pre-suppress reference rate, so the knee — and the
    // mid-taper factor probed here — must not move with strike or maintenance state.
    const world = new InMemoryEconomyWorld({
      systems: [makeProducerSystem("calm", 0), makeProducerSystem("suppressed", 1)],
      markets: [makeMarket("calm", "food", KNEE_MID), makeMarket("suppressed", "food", KNEE_MID)],
      modifiers: [],
    });
    const result = await runEconomyProcessor(world, makeCtx(0), {
      ...ECON_PARAMS,
      maintenanceMalusBySystem: new Map([["suppressed", 0.25]]),
    });
    expect(requireSellingFactor(result.economySignals, "calm", "food")).toBeCloseTo(0.5);
    expect(requireSellingFactor(result.economySignals, "suppressed", "food")).toBeCloseTo(0.5);
  });

  it("is invariant to a production-rate event multiplier", async () => {
    const world = new InMemoryEconomyWorld({
      systems: [makeProducerSystem("plain", 0), makeProducerSystem("event", 0)],
      markets: [makeMarket("plain", "food", KNEE_MID), makeMarket("event", "food", KNEE_MID)],
      modifiers: [{
        domain: "economy",
        type: "rate_multiplier",
        targetType: "system",
        targetId: "event",
        goodId: "food",
        parameter: "production_rate",
        value: 0.25,
      }],
    });
    const result = await runEconomyProcessor(world, makeCtx(0), { ...ECON_PARAMS });
    expect(requireSellingFactor(result.economySignals, "plain", "food")).toBeCloseTo(0.5);
    expect(requireSellingFactor(result.economySignals, "event", "food")).toBeCloseTo(0.5);
  });

  it("retains producer identity when current staffing makes flow zero", async () => {
    const producer = makeProducerSystem("p-zero", 0);
    producer.population = 0;
    const world = new InMemoryEconomyWorld({
      systems: [producer],
      markets: [makeMarket("p-zero", "food", 40)],
      modifiers: [],
    });
    const result = await runEconomyProcessor(world, makeCtx(0), { ...ECON_PARAMS });
    expect(requireSellingFactor(result.economySignals, "p-zero", "food")).toBe(1);
    expect(result.economySignals!.realisedProductionBySystem.get("p-zero")).toBeUndefined();
  });

  it("emits a low selling factor at the ceiling and a high factor below the anchor", async () => {
    const goodId = "food";
    const pinned = new InMemoryEconomyWorld({
      systems: [makeProducerSystem("p-high", 0)],
      markets: [makeMarket("p-high", goodId, FIXTURE_BAND.maxStock - 1)],
      modifiers: [],
    });
    const r1 = await runEconomyProcessor(pinned, makeCtx(0), { ...ECON_PARAMS });
    const uHigh = requireSellingFactor(r1.economySignals, "p-high", goodId);

    const draining = new InMemoryEconomyWorld({
      systems: [makeProducerSystem("p-low", 0)],
      markets: [makeMarket("p-low", goodId, FIXTURE_BAND.minStock + 1)],
      modifiers: [],
    });
    const r2 = await runEconomyProcessor(draining, makeCtx(0), { ...ECON_PARAMS });
    const uLow = requireSellingFactor(r2.economySignals, "p-low", goodId);

    expect(uHigh).toBeLessThan(0.2);
    expect(uLow).toBeGreaterThan(0.8);
    expect(uLow).toBeGreaterThan(uHigh);
  });

  it("records no selling-factor entry for a pure consumer (produces nothing)", async () => {
    const world = new InMemoryEconomyWorld({
      systems: [makeConsumerSystem("c", 0)],
      markets: [makeMarket("c", "food", 100)],
      modifiers: [],
    });
    const r = await runEconomyProcessor(world, makeCtx(0), { ...ECON_PARAMS });
    expect(requireEconomySignals(r.economySignals).sellingFactorBySystem.get("c")).toBeUndefined();
  });
});

// ── Maintenance output malus ──────────────────────────────────────

describe("maintenance output malus", () => {
  it("suppresses production like a sibling of the strike multiplier, per system", async () => {
    // Two identical calm producers; only p2 carries a malus. Same start stock →
    // p2 must end the tick with strictly less stock and less realised output.
    const startStock = FIXTURE_BAND.minStock + 5;
    const world = new InMemoryEconomyWorld({
      systems: [makeProducerSystem("p1", 0), makeProducerSystem("p2", 0)],
      markets: [makeMarket("p1", "food", startStock), makeMarket("p2", "food", startStock)],
      modifiers: [],
    });
    const result = await runEconomyProcessor(world, makeCtx(0), {
      ...ECON_PARAMS,
      maintenanceMalusBySystem: new Map([["p2", 0.5]]),
    });
    const stock = (systemId: string) =>
      world.markets.find((m) => m.systemId === systemId && m.goodId === "food")!.stock;
    expect(stock("p2")).toBeLessThan(stock("p1"));
    const realised = result.economySignals?.realisedProductionBySystem;
    expect(realised?.get("p2")?.get("food") ?? 0).toBeLessThan(realised?.get("p1")?.get("food") ?? 0);
  });
});

// ── Satisfaction: measured flow, persisted ────────────────────────

describe("satisfaction — measured flow, persisted", () => {
  // The emergency threshold is rationCover × demandRate (2 × 1 = 2),
  // independent of the 40-cycle price anchor.
  const rationStock = ECON_PARAMS.simParams.rationCover;
  const satOf = (world: InMemoryEconomyWorld, systemId: string, goodId = "food") =>
    world.markets.find((m) => m.systemId === systemId && m.goodId === goodId)!.satisfaction;

  it("persists satisfaction 1 for a consumer fully served above the ration threshold", async () => {
    // Stock deep above the ration threshold → factor 1 → full delivery →
    // delivered ÷ demanded === 1.
    const world = new InMemoryEconomyWorld({
      systems: [makeConsumerSystem("sys-served", 0)],
      markets: [makeMarket("sys-served", "food", FIXTURE_BAND.maxStock - 1)],
      modifiers: [],
    });
    await runEconomyProcessor(world, makeCtx(0), { ...ECON_PARAMS });
    expect(satOf(world, "sys-served")).toBe(1);
  });

  it("persists the rationed delivered fraction below the threshold", async () => {
    const world = new InMemoryEconomyWorld({
      systems: [makeConsumerSystem("sys-rationed", 0)],
      markets: [makeMarket("sys-rationed", "food", 0.25 * rationStock)],
      modifiers: [],
    });
    await runEconomyProcessor(world, makeCtx(0), { ...ECON_PARAMS });
    expect(satOf(world, "sys-rationed")).toBeCloseTo(0.5, 6);
  });

  it("is flow-measured, not a post-tick stock read (boundary bias)", async () => {
    // Stock starts above the threshold → factor 1 → full delivery. Consumption
    // drains it below the threshold, but the
    // delivery WAS full, so satisfaction is 1 — a post-tick stock read would have
    // reported < 1 from the below-knee ending stock.
    const bigConsumer = makeConsumerSystem("sys-boundary", 0);
    const world = new InMemoryEconomyWorld({
      systems: [bigConsumer],
      markets: [makeMarket("sys-boundary", "food", rationStock + 0.1)],
      modifiers: [],
    });
    await runEconomyProcessor(world, makeCtx(0), { ...ECON_PARAMS });
    const endStock = world.markets.find((m) => m.systemId === "sys-boundary")!.stock;
    expect(satOf(world, "sys-boundary")).toBe(1); // full delivery happened
    expect(endStock).toBeLessThan(rationStock);
  });

  it("persists 1 for pure producers", async () => {
    // A market with no local civilian consumption (population 0 here) is a
    // non-consumer — nothing is demanded, so satisfaction persists 1 regardless
    // of stock, even pinned low inside the ration zone.
    const pureProducer = { ...makeProducerSystem("sys-pureprod", 0), population: 0 };
    const world = new InMemoryEconomyWorld({
      systems: [pureProducer],
      markets: [makeMarket("sys-pureprod", "food", FIXTURE_BAND.minStock + 1)],
      modifiers: [],
    });
    await runEconomyProcessor(world, makeCtx(0), { ...ECON_PARAMS });
    expect(satOf(world, "sys-pureprod")).toBe(1);
  });

  it("feeds the same value into dissatisfactionBySystem", async () => {
    // Single-good rationed consumer (stock 0.25 × ration threshold → satisfaction 0.5).
    // With one good, demand-share = 1, so D = 1 − satisfaction = 0.5 — computed from the SAME
    // persisted satisfaction, not a recomputed stock read. (Was (1 − 0.5)² = 0.25 under the squared
    // fold; this is the assertion that must be restated, not adjusted, when the fold un-squares.)
    const world = new InMemoryEconomyWorld({
      systems: [makeConsumerSystem("sys-fold", 0)],
      markets: [makeMarket("sys-fold", "food", 0.25 * rationStock)],
      modifiers: [],
    });
    const result = await runEconomyProcessor(world, makeCtx(0), { ...ECON_PARAMS });
    const persisted = satOf(world, "sys-fold");
    const d = result.economySignals?.dissatisfactionBySystem.get("sys-fold");
    expect(persisted).toBeCloseTo(0.5, 6); // the persisted flow measure
    expect(d).toBeCloseTo(0.5, 6); // = 1 − 0.5, folded from that same persisted value
  });
});

describe("economy processor: persisted planner assessment", () => {
  it("normalises the persisted realised rate while retaining raw cycle quantity for treasury", async () => {
    const rates: number[] = [];
    for (const interval of [12, 24, 48]) {
      const world = new InMemoryEconomyWorld({
        systems: [makeProducerSystem("producer", 0)],
        markets: [makeMarket("producer", "food", FIXTURE_BAND.targetStock - 2)],
        modifiers: [],
      });
      const result = await runEconomyProcessor(world, makeCtx(0), { ...ECON_PARAMS, interval });
      const market = world.markets[0];
      const rawQuantity = result.economySignals?.realisedProductionBySystem.get("producer")?.get("food") ?? 0;
      expect(market.realisedProductionRate).toBeGreaterThan(0);
      const persistedRate = market.realisedProductionRate;
      if (persistedRate === undefined) throw new Error("Expected persisted realised rate");
      expect(rawQuantity).toBeCloseTo(persistedRate * (interval / 24), 8);
      rates.push(persistedRate);
    }
    expect(rates[0]).toBeCloseTo(rates[1], 8);
    expect(rates[1]).toBeCloseTo(rates[2], 8);
  });

  it("writes explicit zero output for assessed producer and consumer markets", async () => {
    const world = new InMemoryEconomyWorld({
      systems: [makeProducerSystem("producer", 0), makeConsumerSystem("consumer", 0)],
      markets: [
        makeMarket("producer", "food", FIXTURE_BAND.maxStock),
        makeMarket("consumer", "food", 0),
      ],
      modifiers: [],
    });
    await runEconomyProcessor(world, makeCtx(0), { ...ECON_PARAMS });
    expect(world.markets.find((market) => market.systemId === "producer")?.realisedProductionRate).toBe(0);
    expect(world.markets.find((market) => market.systemId === "consumer")?.realisedProductionRate).toBe(0);
  });

  it("records only strike or maintenance as production suppression", async () => {
    const strikeWorld = new InMemoryEconomyWorld({
      systems: [makeProducerSystem("strike", 1)],
      markets: [makeMarket("strike", "food", FIXTURE_BAND.targetStock - 2)],
      modifiers: [],
    });
    await runEconomyProcessor(strikeWorld, makeCtx(0), { ...ECON_PARAMS });
    expect(strikeWorld.markets[0].productionSuppressed).toBe(true);

    const maintenanceWorld = new InMemoryEconomyWorld({
      systems: [makeProducerSystem("maintenance", 0)],
      markets: [makeMarket("maintenance", "food", FIXTURE_BAND.targetStock - 2)],
      modifiers: [],
    });
    await runEconomyProcessor(maintenanceWorld, makeCtx(0), {
      ...ECON_PARAMS,
      maintenanceMalusBySystem: new Map([["maintenance", 0.5]]),
    });
    expect(maintenanceWorld.markets[0].productionSuppressed).toBe(true);

    const eventWorld = new InMemoryEconomyWorld({
      systems: [makeProducerSystem("event", 0)],
      markets: [makeMarket("event", "food", FIXTURE_BAND.targetStock - 2)],
      modifiers: [{
        domain: "economy", type: "rate_multiplier", targetType: "system", targetId: "event",
        goodId: "food", parameter: "production_rate", value: 0.25,
      }],
    });
    await runEconomyProcessor(eventWorld, makeCtx(0), { ...ECON_PARAMS });
    expect(eventWorld.markets[0].productionSuppressed).toBe(false);
  });

  it("flags suppression per market, not across every good at a striking system", async () => {
    // The strike multiplier is a property of the system, but it can only suppress a good the system
    // actually produces. Recording it system-wide told the build planner a strike explained the
    // shortfall of goods this world has no industry for at all — so it refused to propose the very
    // capacity that would end the shortage, and a striking system could never dig itself out.
    const world = new InMemoryEconomyWorld({
      systems: [makeProducerSystem("strike", 1)], // buildings: { food: 2 } — a food producer only
      markets: [
        makeMarket("strike", "food", FIXTURE_BAND.targetStock - 2),
        makeMarket("strike", "ore", FIXTURE_BAND.targetStock - 2), // no ore industry here
      ],
      modifiers: [],
    });
    await runEconomyProcessor(world, makeCtx(0), { ...ECON_PARAMS });
    const bySystemGood = (goodId: string) =>
      world.markets.find((m) => m.systemId === "strike" && m.goodId === goodId)?.productionSuppressed;
    expect(bySystemGood("food")).toBe(true);  // its own output really is struck
    expect(bySystemGood("ore")).toBe(false);  // nothing to suppress — it never made any
  });

  it("advances squeeze only on rationed assessments, saturates, and resets when fully served", async () => {
    // At the reference interval catchUpFactor is 1, so each rationed assessment advances the clock by
    // one whole reference cycle — the integer 0→1→2 saturation and full-satisfaction reset.
    const world = new InMemoryEconomyWorld({
      systems: [makeConsumerSystem("consumer", 0)],
      markets: [{ ...makeMarket("consumer", "food", 0), squeezeCycles: 0 }],
      modifiers: [],
    });
    const ref = { ...ECON_PARAMS, interval: REFERENCE_INTERVAL };
    await runEconomyProcessor(world, makeCtx(0), ref);
    expect(world.markets[0].squeezeCycles).toBe(1);
    await runEconomyProcessor(world, makeCtx(REFERENCE_INTERVAL), ref);
    expect(world.markets[0].squeezeCycles).toBe(2);
    await runEconomyProcessor(world, makeCtx(2 * REFERENCE_INTERVAL), ref);
    expect(world.markets[0].squeezeCycles).toBe(2);
    world.markets[0] = { ...world.markets[0], stock: FIXTURE_BAND.maxStock };
    await runEconomyProcessor(world, makeCtx(3 * REFERENCE_INTERVAL), ref);
    expect(world.markets[0].squeezeCycles).toBe(0);
  });

  it("advances squeeze by the interval's reference-time (catchUpFactor), not a flat step", async () => {
    // A finer cadence advances the clock a fraction of a reference cycle per resolution; a coarser one
    // advances more (and saturates in one assessment) — so "two reference cycles rationed" is the same
    // wall-clock latency at any economy cadence. Tick 0 is a cycle boundary for any interval.
    const fine = new InMemoryEconomyWorld({
      systems: [makeConsumerSystem("consumer", 0)],
      markets: [{ ...makeMarket("consumer", "food", 0), squeezeCycles: 0 }],
      modifiers: [],
    });
    await runEconomyProcessor(fine, makeCtx(0), { ...ECON_PARAMS, interval: 12 });
    expect(fine.markets[0].squeezeCycles).toBeCloseTo(0.5, 6); // catchUpFactor(12) = 0.5

    const coarse = new InMemoryEconomyWorld({
      systems: [makeConsumerSystem("consumer", 0)],
      markets: [{ ...makeMarket("consumer", "food", 0), squeezeCycles: 0 }],
      modifiers: [],
    });
    await runEconomyProcessor(coarse, makeCtx(0), { ...ECON_PARAMS, interval: 48 });
    expect(coarse.markets[0].squeezeCycles).toBe(2); // catchUpFactor(48) = 2 saturates in one
  });
});

// ── Draw-figure inputs ────────────────────────────────────────────

describe("economy processor: persisted draw-figure inputs", () => {
  const marketOf = (world: InMemoryEconomyWorld, systemId: string, goodId: string): WorldMarket => {
    const row = world.markets.find((m) => m.systemId === systemId && m.goodId === goodId);
    if (row === undefined) throw new Error(`Expected a ${goodId} market at ${systemId}`);
    return row;
  };

  it("persists the SYSTEM suppression scalar on every row, including goods the system never produces", async () => {
    // The scalar is a property of the system (its unrest and maintenance funding), unlike the
    // `productionSuppressed` bool beside it, which is false on every good the system has no
    // industry for. Taking the rate from that bool would read 1 on exactly the rows whose
    // consuming industry is struck hardest.
    const world = new InMemoryEconomyWorld({
      systems: [makeProducerSystem("strike", 0.9)], // buildings: { food: 2 } — a food producer only
      markets: [
        makeMarket("strike", "food", FIXTURE_BAND.targetStock - 2),
        makeMarket("strike", "ore", FIXTURE_BAND.targetStock - 2), // no ore industry here
      ],
      modifiers: [],
    });
    await runEconomyProcessor(world, makeCtx(0), { ...ECON_PARAMS });

    const expected = strikeMultiplier(0.9, STRIKE_PARAMS);
    expect(expected).toBeLessThan(1);
    expect(marketOf(world, "strike", "food").productionSuppressRate).toBeCloseTo(expected, 9);
    expect(marketOf(world, "strike", "ore").productionSuppressRate).toBeCloseTo(expected, 9);
    expect(marketOf(world, "strike", "ore").productionSuppressed).toBe(false); // the bool it must not read
  });

  it("writes exactly 1 at a calm, fully-maintained system", async () => {
    const world = new InMemoryEconomyWorld({
      systems: [makeProducerSystem("calm", 0)],
      markets: [makeMarket("calm", "food", FIXTURE_BAND.targetStock - 2)],
      modifiers: [],
    });
    await runEconomyProcessor(world, makeCtx(0), { ...ECON_PARAMS });
    expect(marketOf(world, "calm", "food").productionSuppressRate).toBe(1);
  });

  it("folds the maintenance malus into the same scalar", async () => {
    const world = new InMemoryEconomyWorld({
      systems: [makeProducerSystem("underfunded", 0)],
      markets: [makeMarket("underfunded", "food", FIXTURE_BAND.targetStock - 2)],
      modifiers: [],
    });
    await runEconomyProcessor(world, makeCtx(0), {
      ...ECON_PARAMS,
      maintenanceMalusBySystem: new Map([["underfunded", 0.5]]),
    });
    expect(marketOf(world, "underfunded", "food").productionSuppressRate).toBeCloseTo(0.5, 9);
  });

  it("persists the event production multiplier the tick actually applied, per good", async () => {
    const world = new InMemoryEconomyWorld({
      systems: [makeProducerSystem("event", 0)],
      markets: [
        makeMarket("event", "food", FIXTURE_BAND.targetStock - 2),
        makeMarket("event", "ore", FIXTURE_BAND.targetStock - 2),
      ],
      modifiers: [{
        domain: "economy", type: "rate_multiplier", targetType: "system", targetId: "event",
        goodId: "food", parameter: "production_rate", value: 0.25,
      }],
    });
    await runEconomyProcessor(world, makeCtx(0), { ...ECON_PARAMS });
    expect(marketOf(world, "event", "food").productionMult).toBeCloseTo(0.25, 9);
    expect(marketOf(world, "event", "ore").productionMult).toBe(1); // the modifier names food only
    // The event multiplier is not suppression — the two channels stay distinct on the row.
    expect(marketOf(world, "event", "food").productionSuppressRate).toBe(1);
  });

  it("emits the suppression scalar on economy signals, one entry per system processed", async () => {
    const world = new InMemoryEconomyWorld({
      systems: [makeProducerSystem("strike", 0.9), makeProducerSystem("calm", 0)],
      markets: [
        makeMarket("strike", "food", FIXTURE_BAND.targetStock - 2),
        makeMarket("calm", "food", FIXTURE_BAND.targetStock - 2),
      ],
      modifiers: [],
    });
    const result = await runEconomyProcessor(world, makeCtx(0), { ...ECON_PARAMS });
    const bySystem = requireEconomySignals(result.economySignals).productionSuppressBySystem;
    expect(bySystem.get("strike")).toBeCloseTo(strikeMultiplier(0.9, STRIKE_PARAMS), 9);
    expect(bySystem.get("calm")).toBe(1);
    // The emitted value is the one the tick applied, not a recompute — it must match the rows.
    expect(bySystem.get("strike")).toBe(marketOf(world, "strike", "food").productionSuppressRate);
  });
});

// ── World reads, modifier routing and the row guards ──────────────
// The adapter re-guards every field it is handed, so the processor's own finite/sign guards are only
// visible in what it PASSES to `applyMarketUpdates`. This world records both the call sequence and
// the raw update batch, which is the processor's actual contract with any backend.

class RecordingEconomyWorld extends InMemoryEconomyWorld {
  readonly calls: string[] = [];
  readonly updates: MarketUpdate[] = [];
  override getSystemIds(): Promise<string[]> {
    this.calls.push("getSystemIds");
    return super.getSystemIds();
  }
  override getMarketsForSystems(systemIds: string[]): Promise<MarketView[]> {
    this.calls.push("getMarketsForSystems");
    return super.getMarketsForSystems(systemIds);
  }
  override getModifiers(systemIds: string[]): Promise<ModifierRow[]> {
    this.calls.push("getModifiers");
    return super.getModifiers(systemIds);
  }
  override getUnrest(systemIds: string[]): Promise<Map<string, number>> {
    this.calls.push("getUnrest");
    return super.getUnrest(systemIds);
  }
  override applyMarketUpdates(updates: MarketUpdate[]): Promise<void> {
    this.calls.push("applyMarketUpdates");
    this.updates.push(...updates);
    return super.applyMarketUpdates(updates);
  }
}

describe("economy processor: what it reads before it resolves", () => {
  it("reads nothing at all mid-cycle", async () => {
    // The mid-cycle bail is placed before the system-id read on purpose: fetching the list only to
    // hand its length to a shard window that is empty by construction costs a filter and a sort over
    // every system in the galaxy, 23 ticks out of 24.
    const world = new RecordingEconomyWorld({
      systems: [makeProducerSystem("p", 0)],
      markets: [makeMarket("p", "food", 100)],
      modifiers: [],
    });
    const result = await runEconomyProcessor(world, makeCtx(1), { ...ECON_PARAMS, interval: 4 });
    expect(world.calls).toEqual([]);
    expect(result.economySignals).toBeUndefined();
  });

  it("reads no markets for an empty galaxy", async () => {
    // An empty shard window is the end of the run, not a prelude to a market query for no systems.
    const world = new RecordingEconomyWorld({ systems: [], markets: [], modifiers: [] });
    const result = await runEconomyProcessor(world, makeCtx(0), { ...ECON_PARAMS });
    expect(world.calls).toEqual(["getSystemIds"]);
    expect(result.economySignals).toBeUndefined();
  });

  it("emits no economy signals for a shard whose systems hold no markets", async () => {
    // No markets means nothing was assessed. Emitting empty signals would tell the downstream
    // processors (decay, population) that every system resolved as perfectly supplied this cycle.
    const world = new InMemoryEconomyWorld({
      systems: [makeProducerSystem("p", 0)],
      markets: [],
      modifiers: [],
    });
    const result = await runEconomyProcessor(world, makeCtx(0), { ...ECON_PARAMS });
    expect(result.economySignals).toBeUndefined();
    expect(result.globalEvents!.economyTick![0].systemCount).toBe(0);
  });
});

describe("economy processor: modifier target routing", () => {
  const prodMultOf = (world: InMemoryEconomyWorld, systemId: string) =>
    world.markets.find((m) => m.systemId === systemId && m.goodId === "food")!.productionMult;

  const rateMod = (targetType: "region" | "system", targetId: string): ModifierRow => ({
    domain: "economy", type: "rate_multiplier", targetType, targetId,
    goodId: "food", parameter: "production_rate", value: 0.25,
  });

  it("applies a region-targeted modifier to that region's systems and to nothing else", async () => {
    // The two id spaces are separate namespaces that can collide. A region-targeted modifier reaches
    // the systems IN that region; it must never reach the system that happens to share its id, and
    // the region's own systems must not be missed for the same reason.
    const world = new InMemoryEconomyWorld({
      systems: [
        { ...makeProducerSystem("sys-a", 0), regionId: "rX" },
        { ...makeProducerSystem("other", 0), regionId: "sys-a" },
      ],
      markets: [makeMarket("sys-a", "food", 100), makeMarket("other", "food", 100)],
      modifiers: [rateMod("region", "sys-a")],
    });
    await runEconomyProcessor(world, makeCtx(0), { ...ECON_PARAMS });
    expect(prodMultOf(world, "other")).toBeCloseTo(0.25, 9); // in the named region
    expect(prodMultOf(world, "sys-a")).toBe(1);              // merely shares the region's id
  });

  it("applies a system-targeted modifier to that system and to nothing else", async () => {
    // The mirror case: a system-targeted modifier must not be filed as a region's, or every system
    // in the region that shares the target's id would inherit it.
    const world = new InMemoryEconomyWorld({
      systems: [
        { ...makeProducerSystem("r1", 0), regionId: "rX" },
        { ...makeProducerSystem("member", 0), regionId: "r1" },
      ],
      markets: [makeMarket("r1", "food", 100), makeMarket("member", "food", 100)],
      modifiers: [rateMod("system", "r1")],
    });
    await runEconomyProcessor(world, makeCtx(0), { ...ECON_PARAMS });
    expect(prodMultOf(world, "r1")).toBeCloseTo(0.25, 9);
    expect(prodMultOf(world, "member")).toBe(1); // its region merely shares the target's id
  });

  it("ignores a system-targeted modifier for a system outside the shard", async () => {
    // The processor keeps only the systems it resolved. A modifier naming another one has no bucket
    // to land in, and reaching for one is a crash mid-tick — which hard-pauses the loop.
    class StrayModifierWorld extends RecordingEconomyWorld {
      override async getModifiers(): Promise<ModifierRow[]> {
        return [rateMod("system", "somewhere-else")];
      }
    }
    const world = new StrayModifierWorld({
      systems: [makeProducerSystem("p", 0)],
      markets: [makeMarket("p", "food", 100)],
      modifiers: [],
    });
    await runEconomyProcessor(world, makeCtx(0), { ...ECON_PARAMS });
    expect(prodMultOf(world, "p")).toBe(1);
  });
});

describe("economy processor: satisfaction under an event-modified demand", () => {
  it("measures satisfaction against the demand the tick actually applied", async () => {
    // Satisfaction is delivered ÷ demanded, and BOTH move with the event multiplier. Measured
    // against an unmodified (or inverted) demand, a world whose demand an event halved would report
    // itself starving on a delivery that covered everything it asked for.
    const world = new InMemoryEconomyWorld({
      systems: [makeConsumerSystem("c", 0)],
      markets: [makeMarket("c", "food", FIXTURE_BAND.maxStock - 1)],
      modifiers: [{
        domain: "economy", type: "rate_multiplier", targetType: "system", targetId: "c",
        goodId: "food", parameter: "consumption_rate", value: 0.5,
      }],
    });
    await runEconomyProcessor(world, makeCtx(0), { ...ECON_PARAMS });
    expect(world.markets[0].satisfaction).toBe(1);
  });

  it("weights the dissatisfaction fold by the demand the event left, not its inverse", async () => {
    // The fold's weight is `demanded × necessity`. Halving one good's demand must shrink its share
    // of the world's shortfall; computing the weight the other way round would make an event that
    // RELIEVED a good's demand read as if that good mattered four times as much.
    const rationed = (modifiers: ModifierRow[]) =>
      new InMemoryEconomyWorld({
        systems: [makeConsumerSystem("c", 0)],
        markets: [
          makeMarket("c", "food", 0.25 * ECON_PARAMS.simParams.rationCover), // satisfaction 0.5
          makeMarket("c", "water", 100),                                     // fully served
        ],
        modifiers,
      });

    const plain = rationed([]);
    const plainResult = await runEconomyProcessor(plain, makeCtx(0), { ...ECON_PARAMS });
    const relieved = rationed([{
      domain: "economy", type: "rate_multiplier", targetType: "system", targetId: "c",
      goodId: "water", parameter: "consumption_rate", value: 0.5,
    }]);
    const relievedResult = await runEconomyProcessor(relieved, makeCtx(0), { ...ECON_PARAMS });

    // Premise: the rationed good reads the same in both runs — only water's weight moved.
    const foodSat = (w: InMemoryEconomyWorld) =>
      w.markets.find((m) => m.goodId === "food")!.satisfaction;
    expect(foodSat(plain)).toBeCloseTo(0.5, 6);
    expect(foodSat(relieved)).toBeCloseTo(0.5, 6);
    // Less water demanded ⇒ the shortfall in food carries a larger share of the basket ⇒ higher D.
    const dPlain = plainResult.economySignals!.dissatisfactionBySystem.get("c")!;
    const dRelieved = relievedResult.economySignals!.dissatisfactionBySystem.get("c")!;
    expect(dRelieved).toBeGreaterThan(dPlain);
  });
});

describe("economy processor: the guards on what it writes to a market row", () => {
  // The processor's finite/sign guards, read from the raw update batch — the memory adapter re-guards
  // every one of these on the way in, so a row read back through it cannot tell a guarded value from
  // an unguarded one.
  const capture = async (
    world: RecordingEconomyWorld,
    params: Parameters<typeof runEconomyProcessor>[2],
  ): Promise<MarketUpdate> => {
    await runEconomyProcessor(world, makeCtx(0), params);
    const update = world.updates[0];
    if (update === undefined) throw new Error("Expected a market update");
    return update;
  };

  const producerWorld = () => new RecordingEconomyWorld({
    systems: [makeProducerSystem("p", 0)],
    markets: [makeMarket("p", "food", FIXTURE_BAND.targetStock - 2)],
    modifiers: [],
  });

  it("never writes a non-finite realised rate, however degenerate the cadence", async () => {
    // A zero cadence divides the cycle's realised output by a zero catch-up factor. World state must
    // stay JSON-serialisable: a NaN written here becomes `null` in the save file.
    const update = await capture(producerWorld(), { ...ECON_PARAMS, interval: 0 });
    expect(update.realisedProductionRate).toBe(0);
  });

  it("writes a usable suppression scalar for a corrupt, negative or total maintenance malus", async () => {
    // The scalar gates the logistics draw figure downstream. A non-finite one reads as "no gate"
    // (1), a negative one is not a gate at all, and an honest zero must survive as a zero — the one
    // case a `> 0` test would silently promote back to "fully productive".
    const corrupt = await capture(producerWorld(), {
      ...ECON_PARAMS, maintenanceMalusBySystem: new Map([["p", NaN]]),
    });
    expect(corrupt.productionSuppressRate).toBe(1);

    const negative = await capture(producerWorld(), {
      ...ECON_PARAMS, maintenanceMalusBySystem: new Map([["p", -1]]),
    });
    expect(negative.productionSuppressRate).toBe(1);

    const total = await capture(producerWorld(), {
      ...ECON_PARAMS, maintenanceMalusBySystem: new Map([["p", 0]]),
    });
    expect(total.productionSuppressRate).toBe(0);
  });

  it("writes a usable event multiplier whatever the modifier caps admit", async () => {
    // `productionMult` is capped by a PARAMETER, so the row guard is the only thing standing between
    // a mis-set cap (or a corrupt event value) and a non-finite multiplier in world state. An
    // authored zero, by contrast, is a real "this good is not being made" and must be written as one.
    const eventWorld = (value: number) => new RecordingEconomyWorld({
      systems: [makeProducerSystem("p", 0)],
      markets: [makeMarket("p", "food", FIXTURE_BAND.targetStock - 2)],
      modifiers: [{
        domain: "economy", type: "rate_multiplier", targetType: "system", targetId: "p",
        goodId: "food", parameter: "production_rate", value,
      }],
    });

    const corrupt = await capture(eventWorld(NaN), { ...ECON_PARAMS });
    expect(corrupt.productionMult).toBe(1);

    const negative = await capture(eventWorld(-2), {
      ...ECON_PARAMS, modifierCaps: { ...MODIFIER_CAPS, minMultiplier: -3 },
    });
    expect(negative.productionMult).toBe(1);

    const total = await capture(eventWorld(0), {
      ...ECON_PARAMS, modifierCaps: { ...MODIFIER_CAPS, minMultiplier: 0 },
    });
    expect(total.productionMult).toBe(0);
  });

  it("reports a good whose demand an event has zeroed as fully satisfied", async () => {
    // Nothing demanded is nothing unmet. Dividing the delivery by a zero demand would put a NaN
    // straight into the satisfaction the whole welfare fold is built on.
    const world = new RecordingEconomyWorld({
      systems: [makeConsumerSystem("c", 0)],
      markets: [makeMarket("c", "food", 100)],
      modifiers: [{
        domain: "economy", type: "rate_multiplier", targetType: "system", targetId: "c",
        goodId: "food", parameter: "consumption_rate", value: 0,
      }],
    });
    const update = await capture(world, {
      ...ECON_PARAMS, modifierCaps: { ...MODIFIER_CAPS, minMultiplier: 0 },
    });
    expect(update.satisfaction).toBe(1);
  });
});

describe("economy processor: the shard debug log", () => {
  const debugWorld = (modifiers: ModifierRow[]) => new InMemoryEconomyWorld({
    systems: [makeProducerSystem("p", 0)],
    markets: [makeMarket("p", "food", 100)],
    modifiers,
  });
  const eventMod: ModifierRow = {
    domain: "economy", type: "rate_multiplier", targetType: "system", targetId: "p",
    goodId: "food", parameter: "production_rate", value: 0.5,
  };

  it("says nothing at all unless DEBUG_ECONOMY is set", async () => {
    // A per-shard line on every cycle boundary is a torrent at galaxy scale — the switch is the
    // whole point, and it defaults off.
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await runEconomyProcessor(debugWorld([eventMod]), makeCtx(0), { ...ECON_PARAMS });
      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  it("reports the shard, its systems and its markets when DEBUG_ECONOMY is set", async () => {
    // The switch reads the environment at module load, so the flag has to be set before the module
    // is imported — the same reason it can never be flipped mid-run.
    const previous = process.env.DEBUG_ECONOMY;
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      process.env.DEBUG_ECONOMY = "1";
      vi.resetModules();
      const debug = await import("@/lib/tick/processors/economy");

      await debug.runEconomyProcessor(debugWorld([]), makeCtx(0), { ...ECON_PARAMS });
      // The contract is the modifier-count suffix, not the exact prose: with no active
      // modifiers it is left off the line entirely.
      expect(log).toHaveBeenCalledTimes(1);
      expect(log.mock.calls[0][0]).not.toMatch(/active modifier/);

      await debug.runEconomyProcessor(debugWorld([eventMod]), makeCtx(0), { ...ECON_PARAMS });
      expect(log).toHaveBeenCalledTimes(2);
      expect(log.mock.calls[1][0]).toMatch(/\b1 active modifier\(s\)$/);
    } finally {
      log.mockRestore();
      if (previous === undefined) delete process.env.DEBUG_ECONOMY;
      else process.env.DEBUG_ECONOMY = previous;
      vi.resetModules();
    }
  });
});
