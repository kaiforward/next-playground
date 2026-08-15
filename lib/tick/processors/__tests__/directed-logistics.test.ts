import { describe, it, expect } from "vitest";
import { MemoryDirectedLogisticsWorld } from "@/lib/tick/adapters/memory/directed-logistics";
import { emptyResourceVector } from "@/lib/engine/resources";
import { runDirectedLogisticsProcessor } from "@/lib/tick/processors/directed-logistics";
import { DIRECTED_LOGISTICS } from "@/lib/constants/directed-logistics";
import { allSystemIdsReachable } from "@/lib/engine/directed-logistics";
import { LOGISTICS_INTERVAL } from "@/lib/constants/tick-cadence";
import { consumptionRate } from "@/lib/engine/physical-economy";
import {
  computeSystemLabourSnapshot, inputDemandForGood, buildingProduction,
} from "@/lib/engine/industry";
import { brakeKnee } from "@/lib/engine/tick";
import { ECONOMY_SIM_PARAMS } from "@/lib/constants/economy";
import type { SystemLogisticsRow } from "@/lib/tick/world/directed-logistics-world";

describe("MemoryDirectedLogisticsWorld", () => {
  it("groups systems by faction key (null = independents)", async () => {
    const world = new MemoryDirectedLogisticsWorld([
      { systemId: "A", factionId: "f1", population: 10, buildings: {}, yields: emptyResourceVector(), markets: [] },
      { systemId: "B", factionId: null, population: 5, buildings: {}, yields: emptyResourceVector(), markets: [] },
    ]);
    const keys = await world.getFactionShardKeys();
    expect(new Set(keys)).toEqual(new Set(["f1", null]));
    const f1 = await world.getSystemsForFactions(["f1"]);
    expect(f1.map((s) => s.systemId)).toEqual(["A"]);
  });

  it("applies stock updates and records flows", async () => {
    const world = new MemoryDirectedLogisticsWorld([]);
    await world.applyMarketUpdates([{ id: "m1", stock: 42 }]);
    await world.appendLogisticsFlows([{ tick: 1, fromSystemId: "A", toSystemId: "B", goodId: "g", quantity: 8 }]);
    expect(world.stockUpdates.get("m1")).toBe(42);
    expect(world.flows).toHaveLength(1);
  });

  it("applies demand-unservable updates", async () => {
    const world = new MemoryDirectedLogisticsWorld([]);
    await world.applyDemandUnservableUpdates([{ id: "m1", demandUnservable: true }]);
    expect(world.demandUnservableUpdates.get("m1")).toBe(true);
  });
});

// ── fixture population and the demand rates it implies (ECONOMY_SCALE=1 under vitest)
// Every system below carries FIXTURE_POP people, so each market's persisted `demandRate` must be the
// rate that population actually consumes — that is what the population processor writes each cycle
// (`rewriteDemandRates` → `totalDemandRateForGood`). Hand-picking a round `demandRate` next to an
// unrelated `population` describes a world the tick cannot produce, and the deficit test reads the
// population-derived figure (`logisticsTarget`), not the row column.
const FIXTURE_POP = 200;
const rateFor = (goodId: string) =>
  consumptionRate(goodId, { population: FIXTURE_POP, technicians: 0, engineers: 0 });

// ── market band math (anchorMult:1; GOODS.food priceFloor:0.5, priceCeiling:2.0)
// food @ 200 pop → demandRate = 1.2, so targetStock = logisticsTarget = 40×1.2 = 48.
// mA: stock=95, storageCapacity=20 → surplusThreshold=48×1.4=67.2; 95≥67.2 ✓ surplus; drawable=95−48=47.
// mB: stock=10, storageCapacity=20 → deficitThreshold=48×0.8=38.4; 10<38.4 ✓ deficit; shortfall=48−10=38.
// mOther (ore) @ 200 pop → demandRate = 0.4, target 16; stock 40 clears both thresholds as a donor
// with no matching deficit, so it stays out of every assertion below.
// tick=0 (cycle start boundary): cycleStartShard(1, 0, 24) → start=0, end=1 (all factions redistribute).
// budget = 2 systems × 200 pop × GENERATION_PER_POP 5 = 2000.
// engine quantity=min(shortfall 38, drawable 47, affordable 2000)=38. A logistics delivery is a level-fill
// toward the target, so the body moves exactly that (no catch-up) → mB lands at 48 (=target).
const FOOD_TARGET = 48;

function market(
  id: string,
  goodId: string,
  stock: number,
  storageCapacity: number,
  logisticsFundingBound?: boolean,
) {
  return {
    id, goodId, stock,
    anchorMult: 1, demandRate: rateFor(goodId), storageCapacity,
    logisticsFundingBound,
  };
}

const DUE_TICK = 0; // cycle start: all factions redistribute on ticks where tick % interval === 0

describe("runDirectedLogisticsProcessor (body)", () => {
  it("moves staple surplus to a deficit system and records a logistics flow", async () => {
    const systems = [
      {
        systemId: "A", factionId: "f1", population: 200, buildings: {},
        yields: emptyResourceVector(), markets: [market("mA", "food", 95, 20)],
      },
      {
        systemId: "B", factionId: "f1", population: 200, buildings: {},
        yields: emptyResourceVector(), markets: [market("mB", "food", 10, 20)],
      },
    ];
    const world = new MemoryDirectedLogisticsWorld(systems);
    await runDirectedLogisticsProcessor(
      world,
      { tick: DUE_TICK },
      { interval: LOGISTICS_INTERVAL, routeCost: () => 1, reachableSystemIds: allSystemIdsReachable },
    );
    expect(world.flows).toHaveLength(1);
    expect(world.flows[0]).toMatchObject({ fromSystemId: "A", toSystemId: "B", goodId: "food" });
    expect(world.flows[0].quantity).toBeGreaterThan(0);
    // both market stocks were written (source down, dest up)
    expect(world.stockUpdates.has("mA")).toBe(true);
    expect(world.stockUpdates.has("mB")).toBe(true);
  });

  it("reports work performed by the faction, equal to the planned transfer cost", async () => {
    const systems = [
      {
        systemId: "A", factionId: "f1", population: 200, buildings: {},
        yields: emptyResourceVector(), markets: [market("mA", "food", 95, 20)],
      },
      {
        systemId: "B", factionId: "f1", population: 200, buildings: {},
        yields: emptyResourceVector(), markets: [market("mB", "food", 10, 20)],
      },
    ];
    const world = new MemoryDirectedLogisticsWorld(systems);
    const result = await runDirectedLogisticsProcessor(
      world,
      { tick: DUE_TICK },
      { interval: LOGISTICS_INTERVAL, routeCost: () => 1, reachableSystemIds: allSystemIdsReachable },
    );
    // routeCost is a flat 1/unit, so the planned cost equals the moved quantity.
    expect(result.workPerformedByFaction?.get("f1")).toBeCloseTo(world.flows[0].quantity, 6);
  });

  it("reports the per-faction haul budget beside the work performed", async () => {
    // Same surplus/deficit pair as the happy path. Budget total = Σ pop × GENERATION_PER_POP
    // × catchUp (1 at the reference interval) = 2 × 200 × 5 = 2000; spent = the one transfer's
    // cost (route cost 1 × quantity 38); nothing funding-bound.
    const systems = [
      {
        systemId: "A", factionId: "f1", population: 200, buildings: {},
        yields: emptyResourceVector(), markets: [market("mA", "food", 95, 20)],
      },
      {
        systemId: "B", factionId: "f1", population: 200, buildings: {},
        yields: emptyResourceVector(), markets: [market("mB", "food", 10, 20)],
      },
    ];
    const world = new MemoryDirectedLogisticsWorld(systems);
    const result = await runDirectedLogisticsProcessor(
      world,
      { tick: DUE_TICK },
      { interval: LOGISTICS_INTERVAL, routeCost: () => 1, reachableSystemIds: allSystemIdsReachable },
    );
    const budget = result.logisticsBudget?.get("f1");
    expect(budget?.total).toBeCloseTo(2000, 6);
    expect(budget?.spent).toBeCloseTo(38, 6);
    expect(budget?.fundingBoundCount).toBe(0);
  });

  it("counts a multi-donor fan-out's spend once, as the sum of its draws", async () => {
    // One deficit (shortfall 38) filled from two donors of drawable 22 each (stock 70 − target 48),
    // so the run emits two flow rows (draws of 22 and 16). Spent must equal the summed draw costs
    // — 38 at route cost 1 — and agree with the treasury's work figure; a ledger that also counted
    // per-row would read 76 and bill the faction twice for one haul.
    const systems = [
      {
        systemId: "A1", factionId: "f1", population: 200, buildings: {},
        yields: emptyResourceVector(), markets: [market("mA1", "food", 70, 20)],
      },
      {
        systemId: "A2", factionId: "f1", population: 200, buildings: {},
        yields: emptyResourceVector(), markets: [market("mA2", "food", 70, 20)],
      },
      {
        systemId: "B", factionId: "f1", population: 200, buildings: {},
        yields: emptyResourceVector(), markets: [market("mB", "food", 10, 20)],
      },
    ];
    const world = new MemoryDirectedLogisticsWorld(systems);
    const result = await runDirectedLogisticsProcessor(
      world,
      { tick: DUE_TICK },
      { interval: LOGISTICS_INTERVAL, routeCost: () => 1, reachableSystemIds: allSystemIdsReachable },
    );
    expect(world.flows).toHaveLength(2);
    const budget = result.logisticsBudget?.get("f1");
    expect(budget?.total).toBeCloseTo(3000, 6);
    expect(budget?.spent).toBeCloseTo(38, 6);
    expect(result.workPerformedByFaction?.get("f1")).toBeCloseTo(38, 6);
    // Conservation across the fan-out: the second draw lands on a recipient the first draw
    // already topped up, so the apply loop must carry mB's updated stock forward —
    // 10 + 22 + 16 = 48 — with each donor down by exactly its own draw.
    expect(world.flows[0]).toMatchObject({ fromSystemId: "A1", quantity: 22 });
    expect(world.flows[1]).toMatchObject({ fromSystemId: "A2", quantity: 16 });
    expect(world.stockUpdates.get("mB")).toBeCloseTo(FOOD_TARGET, 6);
    expect(world.stockUpdates.get("mA1")).toBeCloseTo(48, 6);
    expect(world.stockUpdates.get("mA2")).toBeCloseTo(54, 6);
  });

  it("hauls for independents but keeps them off the budget ledger", async () => {
    // The ledger mirrors workPerformedByFaction: faction-owned groups only. Independents'
    // transfers still move — their haul just isn't billed or counted into budgetSpentFrac.
    const systems = [
      {
        systemId: "A", factionId: null, population: 200, buildings: {},
        yields: emptyResourceVector(), markets: [market("mA", "food", 95, 20)],
      },
      {
        systemId: "B", factionId: null, population: 200, buildings: {},
        yields: emptyResourceVector(), markets: [market("mB", "food", 10, 20)],
      },
      {
        systemId: "C", factionId: "f1", population: 200, buildings: {},
        yields: emptyResourceVector(), markets: [market("mC", "food", 95, 20)],
      },
      {
        systemId: "D", factionId: "f1", population: 200, buildings: {},
        yields: emptyResourceVector(), markets: [market("mD", "food", 10, 20)],
      },
    ];
    const world = new MemoryDirectedLogisticsWorld(systems);
    const result = await runDirectedLogisticsProcessor(
      world,
      { tick: DUE_TICK },
      { interval: LOGISTICS_INTERVAL, routeCost: () => 1, reachableSystemIds: allSystemIdsReachable },
    );
    expect(world.flows).toHaveLength(2);
    expect(world.flows.some((f) => f.fromSystemId === "A" && f.toSystemId === "B")).toBe(true);
    expect(result.logisticsBudget?.size).toBe(1);
    expect(result.logisticsBudget?.get("f1")?.total).toBeCloseTo(2000, 6);
  });

  it("counts funding-bound deficits in the budget ledger", async () => {
    // funded 0 → a zero budget the one reachable deficit cannot draw against: total 0, spent 0,
    // and exactly one funding-bound record.
    const systems = [
      {
        systemId: "A", factionId: "f1", population: 200, buildings: {},
        yields: emptyResourceVector(), markets: [market("mA", "food", 95, 20)],
      },
      {
        systemId: "B", factionId: "f1", population: 200, buildings: {},
        yields: emptyResourceVector(), markets: [market("mB", "food", 10, 20)],
      },
    ];
    const world = new MemoryDirectedLogisticsWorld(systems);
    const result = await runDirectedLogisticsProcessor(world, { tick: DUE_TICK }, {
      interval: LOGISTICS_INTERVAL,
      routeCost: () => 1,
      reachableSystemIds: allSystemIdsReachable,
      fundingByFaction: new Map([["f1", 0]]),
    });
    expect(result.logisticsBudget?.get("f1")).toEqual({ total: 0, spent: 0, fundingBoundCount: 1 });
  });

  it("fills a deficit toward its anchor in one delivery — never overshoots into surplus", async () => {
    // Regression for the catch-up overshoot: a single delivery is a level-fill toward the
    // cycles-of-supply target (logisticsTarget), NOT a rate that scales with the shard interval.
    // mB: stock 10, target 48 → must land at the target, not be doubled into surplus (≥67.2).
    const systems = [
      {
        systemId: "A", factionId: "f1", population: 200, buildings: {},
        yields: emptyResourceVector(), markets: [market("mA", "food", 95, 20)],
      },
      {
        systemId: "B", factionId: "f1", population: 200, buildings: {},
        yields: emptyResourceVector(), markets: [market("mB", "food", 10, 20)],
      },
    ];
    const world = new MemoryDirectedLogisticsWorld(systems);
    await runDirectedLogisticsProcessor(
      world,
      { tick: DUE_TICK },
      { interval: LOGISTICS_INTERVAL, routeCost: () => 1, reachableSystemIds: allSystemIdsReachable },
    );
    const surplusThreshold = FOOD_TARGET * DIRECTED_LOGISTICS.SURPLUS_MARGIN; // 67.2
    const mBStock = world.stockUpdates.get("mB")!;
    expect(mBStock).toBeGreaterThan(10); // something was delivered
    expect(mBStock).toBeLessThanOrEqual(FOOD_TARGET); // filled to the target, no further
    expect(mBStock).toBeLessThan(surplusThreshold); // and not flipped into a surplus donor
    // conservation: donor lost exactly what the recipient gained
    expect(world.stockUpdates.get("mA")!).toBeCloseTo(95 - (mBStock - 10), 6);
  });

  it("applies a fractional transfer without quantizing (scale-invariance guard)", async () => {
    // The engine matcher works in continuous goods units; the processor must apply the
    // transfer as-is. A fractional deficit stock (10.3) makes the shortfall fractional
    // (48 − 10.3 = 37.7); flooring here would drop it to 37. That lost unit is ~2% at
    // these magnitudes but a large fraction at ECONOMY_SCALE=1 and negligible at 100 —
    // the exact scale-variance this guards. Budget (population-scaled) and drawable (47)
    // both exceed the shortfall, so the shortfall is the binding, fractional quantity.
    const systems = [
      {
        systemId: "A", factionId: "f1", population: 200, buildings: {},
        yields: emptyResourceVector(), markets: [market("mA", "food", 95, 20)],
      },
      {
        systemId: "B", factionId: "f1", population: 200, buildings: {},
        yields: emptyResourceVector(), markets: [market("mB", "food", 10.3, 20)],
      },
    ];
    const world = new MemoryDirectedLogisticsWorld(systems);
    await runDirectedLogisticsProcessor(
      world,
      { tick: DUE_TICK },
      { interval: LOGISTICS_INTERVAL, routeCost: () => 1, reachableSystemIds: allSystemIdsReachable },
    );
    expect(world.flows[0].quantity).toBeCloseTo(37.7, 6); // the fraction survives — NOT 37
    expect(world.stockUpdates.get("mB")!).toBeCloseTo(FOOD_TARGET, 6); // filled exactly to the target
    // conservation: donor lost exactly the fractional amount the recipient gained
    expect(world.stockUpdates.get("mA")!).toBeCloseTo(95 - 37.7, 6);
  });

  it("does nothing for an empty world", async () => {
    // empty world → getFactionShardKeys() returns [] → factionKeys.length === 0 → early return (before shardRange)
    const world = new MemoryDirectedLogisticsWorld([]);
    await runDirectedLogisticsProcessor(
      world,
      { tick: 7 },
      { interval: LOGISTICS_INTERVAL, routeCost: () => 1, reachableSystemIds: allSystemIdsReachable },
    );
    expect(world.flows).toHaveLength(0);
  });

  it("moves nothing on an off-boundary tick (cycle start)", async () => {
    // Same surplus(mA)+deficit(mB) as the happy path, but tick=1: cycleStartShard(1, 1, 24) is an
    // empty window off the cycle boundary, so NO faction redistributes — distinct from the
    // empty-world early return.
    const systems = [
      {
        systemId: "A", factionId: "f1", population: 200, buildings: {},
        yields: emptyResourceVector(), markets: [market("mA", "food", 95, 20)],
      },
      {
        systemId: "B", factionId: "f1", population: 200, buildings: {},
        yields: emptyResourceVector(), markets: [market("mB", "food", 10, 20)],
      },
    ];
    const world = new MemoryDirectedLogisticsWorld(systems);
    await runDirectedLogisticsProcessor(
      world,
      { tick: 1 },
      { interval: LOGISTICS_INTERVAL, routeCost: () => 1, reachableSystemIds: allSystemIdsReachable },
    );
    expect(world.flows).toHaveLength(0);
    expect(world.stockUpdates.size).toBe(0);
    expect(world.fundingBoundUpdates.size).toBe(0);
  });

  it("haul budget scales with the interval; deliveries stay gap-fills", async () => {
    // Budget-bound: an ample donor and an expensive route, so the per-cycle work budget
    // (Σ pop × generation = 2000) binds well before the 38-unit gap does — moved = budget ÷ route
    // cost = 10. Halving the interval halves the budget, so it moves half as much per cycle (same
    // wall-clock haul capacity when run twice as often).
    //
    // The cost is what makes the budget bind. Inflating `demandRate` to blow up the target no
    // longer works and never described a real world: the deficit is measured against demand the
    // population actually has, so a market's target cannot be raised without raising the population
    // that funds the budget alongside it.
    const EXPENSIVE = 200;
    const budgetBound = () => [
      { systemId: "A", factionId: "f1", population: FIXTURE_POP, buildings: {}, yields: emptyResourceVector(), markets: [market("mA", "food", 100000, 0)] },
      { systemId: "B", factionId: "f1", population: FIXTURE_POP, buildings: {}, yields: emptyResourceVector(), markets: [market("mB", "food", 10, 0)] },
    ];
    const movedAt = async (interval: number): Promise<number> => {
      const world = new MemoryDirectedLogisticsWorld(budgetBound());
      await runDirectedLogisticsProcessor(world, { tick: 0 }, {
        interval,
        routeCost: () => EXPENSIVE,
        reachableSystemIds: allSystemIdsReachable,
      });
      return world.flows[0].quantity;
    };
    const moved24 = await movedAt(24);
    const moved12 = await movedAt(12);
    expect(moved24).toBeGreaterThan(0);
    // Budget-bound, not gap-bound — the guard that keeps this case testing what it claims to.
    expect(moved24).toBeLessThan(FOOD_TARGET - 10);
    expect(moved12).toBeCloseTo(moved24 / 2, 6); // budget scaled with the interval

    // Gap-bound: a small deficit (shortfall 38) with an ample budget fills exactly the gap — a
    // level-fill toward the target, interval-invariant, NOT a scaled multiple.
    const gapFill = async (interval: number): Promise<number> => {
      const systems = [
        { systemId: "A", factionId: "f1", population: 200, buildings: {}, yields: emptyResourceVector(), markets: [market("mA", "food", 95, 20)] },
        { systemId: "B", factionId: "f1", population: 200, buildings: {}, yields: emptyResourceVector(), markets: [market("mB", "food", 10, 20)] },
      ];
      const world = new MemoryDirectedLogisticsWorld(systems);
      await runDirectedLogisticsProcessor(world, { tick: 0 }, {
        interval,
        routeCost: () => 1,
        reachableSystemIds: allSystemIdsReachable,
      });
      return world.flows[0].quantity;
    };
    expect(await gapFill(24)).toBeCloseTo(38, 6);
    expect(await gapFill(12)).toBeCloseTo(38, 6); // identical at half the interval — gap-fills don't scale
  });

  it("scales the haul budget by the faction's funded fraction (0 → no transfers)", async () => {
    const mk = () => [
      {
        systemId: "A", factionId: "f1", population: 200, buildings: {},
        yields: emptyResourceVector(), markets: [market("mA", "food", 95, 20)],
      },
      {
        systemId: "B", factionId: "f1", population: 200, buildings: {},
        yields: emptyResourceVector(), markets: [market("mB", "food", 10, 20)],
      },
    ];
    // funded 0 → generation × 0 = no work budget → nothing moves.
    const gated = new MemoryDirectedLogisticsWorld(mk());
    await runDirectedLogisticsProcessor(gated, { tick: DUE_TICK }, {
      interval: LOGISTICS_INTERVAL,
      routeCost: () => 1,
      reachableSystemIds: allSystemIdsReachable,
      fundingByFaction: new Map([["f1", 0]]),
    });
    expect(gated.flows).toHaveLength(0);
    expect(gated.fundingBoundUpdates.get("mA")).toBe(true);
    expect(gated.fundingBoundUpdates.get("mB")).toBe(true);

    // A faction missing from the map is ungated — identical to no map at all.
    const ungated = new MemoryDirectedLogisticsWorld(mk());
    await runDirectedLogisticsProcessor(ungated, { tick: DUE_TICK }, {
      interval: LOGISTICS_INTERVAL,
      routeCost: () => 1,
      reachableSystemIds: allSystemIdsReachable,
      fundingByFaction: new Map([["other", 0]]),
    });
    expect(ungated.flows).toHaveLength(1);
  });

  it("writes only changed assessments and clears a recovered funding-bound marker", async () => {
    const systems = [
      {
        systemId: "A", factionId: "f1", population: 200, buildings: {},
        yields: emptyResourceVector(), markets: [
          market("mA", "food", 95, 20),
          market("mOther", "ore", 40, 20),
        ],
      },
      {
        systemId: "B", factionId: "f1", population: 200, buildings: {},
        yields: emptyResourceVector(), markets: [market("mB", "food", 10, 20)],
      },
    ];
    const world = new MemoryDirectedLogisticsWorld(systems);
    await runDirectedLogisticsProcessor(world, { tick: DUE_TICK }, {
      interval: LOGISTICS_INTERVAL,
      routeCost: () => 1,
      reachableSystemIds: allSystemIdsReachable,
      fundingByFaction: new Map([["f1", 0]]),
    });
    expect(world.fundingBoundUpdates.get("mA")).toBe(true);
    expect(world.fundingBoundUpdates.get("mB")).toBe(true);
    expect(world.fundingBoundUpdates.has("mOther")).toBe(false);
    expect(world.fundingBoundUpdates.size).toBe(2);

    const recoveredWorld = new MemoryDirectedLogisticsWorld([
      {
        systemId: "A", factionId: "f1", population: 200, buildings: {},
        yields: emptyResourceVector(), markets: [
          market("mA", "food", 95, 20, true),
          market("mOther", "ore", 40, 20),
        ],
      },
      {
        systemId: "B", factionId: "f1", population: 200, buildings: {},
        yields: emptyResourceVector(), markets: [market("mB", "food", 10, 20, true)],
      },
    ]);
    await runDirectedLogisticsProcessor(recoveredWorld, { tick: DUE_TICK }, {
      interval: LOGISTICS_INTERVAL,
      routeCost: () => 1,
      reachableSystemIds: allSystemIdsReachable,
    });
    expect(recoveredWorld.fundingBoundUpdates.get("mA")).toBe(false);
    expect(recoveredWorld.fundingBoundUpdates.get("mB")).toBe(false);
    expect(recoveredWorld.fundingBoundUpdates.has("mOther")).toBe(false);
    expect(recoveredWorld.fundingBoundUpdates.size).toBe(2);
  });

  it("marks a structurally unservable deficit and clears it once a donor becomes reachable", async () => {
    // Run 1: B alone — no other system in the match holds food at all, so no reachable donor exists
    // regardless of budget. Structural, and (unlike a funding-bound deficit) not a matter of money.
    const isolated = new MemoryDirectedLogisticsWorld([
      {
        systemId: "B", factionId: "f1", population: 200, buildings: {},
        yields: emptyResourceVector(), markets: [market("mB", "food", 10, 20)],
      },
    ]);
    await runDirectedLogisticsProcessor(isolated, { tick: DUE_TICK }, {
      interval: LOGISTICS_INTERVAL, routeCost: () => 1, reachableSystemIds: allSystemIdsReachable,
    });
    expect(isolated.demandUnservableUpdates.get("mB")).toBe(true);
    // Never budget-stopped at all (no candidate donor even entered the draw loop), so the funding-
    // bound assessment is unchanged from its prior absence — no write, not an explicit false.
    expect(isolated.fundingBoundUpdates.has("mB")).toBe(false);

    // Run 2: the same deficit, now carrying the prior TRUE reading, with an ample donor added and
    // reachable. The shortfall (38) is well inside the donor's drawable (47) and the budget (2000),
    // so the deficit is fully served — the flag must explicitly clear to false, not merely go
    // unwritten.
    const recovered = new MemoryDirectedLogisticsWorld([
      {
        systemId: "A", factionId: "f1", population: 200, buildings: {},
        yields: emptyResourceVector(), markets: [market("mA", "food", 95, 20)],
      },
      {
        systemId: "B", factionId: "f1", population: 200, buildings: {},
        yields: emptyResourceVector(), markets: [{ ...market("mB", "food", 10, 20), demandUnservable: true }],
      },
    ]);
    await runDirectedLogisticsProcessor(recovered, { tick: DUE_TICK }, {
      interval: LOGISTICS_INTERVAL, routeCost: () => 1, reachableSystemIds: allSystemIdsReachable,
    });
    expect(recovered.demandUnservableUpdates.get("mB")).toBe(false);
    expect(recovered.demandUnservableUpdates.has("mA")).toBe(false); // a donor is never a candidate for this flag
  });

  it("keeps unreachable pairs unmarked", async () => {
    const systems = [
      { systemId: "A", factionId: "f1", population: 0, buildings: {}, yields: emptyResourceVector(), markets: [market("mA", "food", 95, 20)] },
      { systemId: "B", factionId: "f1", population: 0, buildings: {}, yields: emptyResourceVector(), markets: [market("mB", "food", 10, 20)] },
    ];
    const world = new MemoryDirectedLogisticsWorld(systems);
    await runDirectedLogisticsProcessor(world, { tick: DUE_TICK }, {
      interval: LOGISTICS_INTERVAL,
      routeCost: () => null,
      reachableSystemIds: allSystemIdsReachable,
    });
    expect(world.fundingBoundUpdates.size).toBe(0);
  });
  it("treats an assessed zero-output producer as a logistics sink despite nonzero capacity", async () => {
    const systems: SystemLogisticsRow[] = [
      {
        systemId: "A", factionId: "f1", population: 200,
        buildings: { food: 3 }, yields: emptyResourceVector(),
        markets: [{ ...market("mA", "food", 10, 20), realizedProductionRate: 0 }],
      },
      {
        systemId: "B", factionId: "f1", population: 200,
        buildings: {}, yields: emptyResourceVector(), markets: [market("mB", "food", 95, 20)],
      },
    ];
    const world = new MemoryDirectedLogisticsWorld(systems);
    await runDirectedLogisticsProcessor(world, { tick: DUE_TICK }, {
      interval: LOGISTICS_INTERVAL, routeCost: () => 1, reachableSystemIds: allSystemIdsReachable,
    });
    expect(world.flows).toHaveLength(1);
    expect(world.flows[0]).toMatchObject({ fromSystemId: "B", toSystemId: "A", goodId: "food" });
  });

  describe("drawBrakeCeiling third-arm pin", () => {
    // Mirrors good-market-state.test.ts's third-arm fixture: a metals producer whose OWN brake
    // gates ore's urgency. At METALS_STOCK the live knee reads metals as braked shut (ore's draw
    // collapses to civilian want alone); the retired anchor ceiling, pinned to a far larger price
    // anchor, reads the same stock as unbraked (ore's draw stays at its full civilian+industrial
    // want). A second, plain ore consumer with no industry sits at a fixed severity in between, so
    // which recipient a budget-limited donor services first flips with the switch — the only way
    // urgency (never a stock or target) can change what the processor actually moves.
    const METALS_BUILDINGS = { metals: 3, vocational_school: 1 };
    const METALS_POP = 100;
    const snap = computeSystemLabourSnapshot(METALS_BUILDINGS, METALS_POP);
    const metalsUse = consumptionRate("metals", snap.basis)
      + inputDemandForGood(METALS_BUILDINGS, "metals", snap.state, emptyResourceVector());
    const metalsCapacity = buildingProduction(METALS_BUILDINGS, "metals", snap.state, emptyResourceVector());
    const METALS_STOCK = brakeKnee(
      { useRate: metalsUse, capacityProduction: metalsCapacity, anchorMult: 1 },
      ECONOMY_SIM_PARAMS,
    ).rampEnd + 1;
    // A price-anchor demandRate far above METALS_STOCK/TARGET_COVER keeps the anchor ceiling at 1
    // (unbraked) at this stock, whatever TARGET_COVER is tuned to.
    const METALS_DEMAND_RATE = 100_000;

    const oreCivilianR1 = consumptionRate("ore", snap.basis);
    const oreFullR1 = oreCivilianR1 + inputDemandForGood(METALS_BUILDINGS, "ore", snap.state, emptyResourceVector());

    const R2_POP = METALS_POP * 4;
    const oreCivilianR2 = consumptionRate(
      "ore",
      computeSystemLabourSnapshot({}, R2_POP).basis,
    );

    // The ordering the whole fixture rests on: R2's fixed want sits strictly between R1's two
    // possible readings, so the switch alone decides which recipient outranks the other.
    expect(oreCivilianR1).toBeLessThan(oreCivilianR2);
    expect(oreCivilianR2).toBeLessThan(oreFullR1);

    const SHORTFALL = 200;
    const oreWant = SHORTFALL / DIRECTED_LOGISTICS.WAREHOUSE_COVER;
    const ROUTE_COST = 10;

    function buildWorld(): MemoryDirectedLogisticsWorld {
      return new MemoryDirectedLogisticsWorld([
        {
          systemId: "D", factionId: "f1", population: 0, buildings: {},
          yields: emptyResourceVector(),
          markets: [{ id: "mD", goodId: "ore", stock: 100_000, anchorMult: 1, demandRate: 1, storageCapacity: 0 }],
        },
        {
          systemId: "R1", factionId: "f1", population: METALS_POP, buildings: METALS_BUILDINGS,
          yields: emptyResourceVector(),
          markets: [
            // demandRate is set well above oreWant so the PRICING band's maxStock (a different,
            // demandRate-denominated ceiling) never clips a delivery below the logistics shortfall
            // this fixture is sized on — the two figures deliberately measure different things.
            { id: "mR1ore", goodId: "ore", stock: 0, anchorMult: 1, demandRate: 1000, storageCapacity: 0, honestUseRate: oreWant },
            { id: "mR1metals", goodId: "metals", stock: METALS_STOCK, anchorMult: 1, demandRate: METALS_DEMAND_RATE, storageCapacity: 0 },
          ],
        },
        {
          systemId: "R2", factionId: "f1", population: R2_POP, buildings: {},
          yields: emptyResourceVector(),
          markets: [
            { id: "mR2ore", goodId: "ore", stock: 0, anchorMult: 1, demandRate: 1000, storageCapacity: 0, honestUseRate: oreWant },
          ],
        },
      ]);
    }

    const oreReceivedBy = (world: MemoryDirectedLogisticsWorld, systemId: string): number =>
      world.flows.filter((f) => f.toSystemId === systemId && f.goodId === "ore")
        .reduce((sum, f) => sum + f.quantity, 0);

    it("services the higher-severity recipient first, live vs pinned to the retired anchor", async () => {
      const live = buildWorld();
      await runDirectedLogisticsProcessor(live, { tick: DUE_TICK }, {
        interval: LOGISTICS_INTERVAL, routeCost: () => ROUTE_COST, reachableSystemIds: allSystemIdsReachable,
      });
      // Live: R1's ore draw is braked to civilian-only (lower than R2's), so R2 outranks it and is
      // serviced in full first; the budget-limited remainder to R1 is a partial fill.
      expect(oreReceivedBy(live, "R2")).toBeCloseTo(SHORTFALL, 6);
      expect(oreReceivedBy(live, "R1")).toBeGreaterThan(0);
      expect(oreReceivedBy(live, "R1")).toBeLessThan(SHORTFALL);

      const pinned = buildWorld();
      await runDirectedLogisticsProcessor(pinned, { tick: DUE_TICK }, {
        interval: LOGISTICS_INTERVAL, routeCost: () => ROUTE_COST, reachableSystemIds: allSystemIdsReachable,
        drawBrakeCeiling: "anchor",
      });
      // Pinned: the anchor ceiling reads the same metals stock as unbraked, so R1's ore draw rises
      // to its full civilian+industrial want (above R2's) and the priority flips.
      expect(oreReceivedBy(pinned, "R1")).toBeCloseTo(SHORTFALL, 6);
      expect(oreReceivedBy(pinned, "R2")).toBeGreaterThan(0);
      expect(oreReceivedBy(pinned, "R2")).toBeLessThan(SHORTFALL);

      // The divergence the fix exists to protect: identical fixture, only the switch differs.
      expect(oreReceivedBy(live, "R1")).not.toBeCloseTo(oreReceivedBy(pinned, "R1"), 3);
    });
  });
});
