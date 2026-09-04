import { describe, it, expect } from "vitest";
import { MemoryDirectedLogisticsWorld } from "@/lib/tick/adapters/memory/directed-logistics";
import { emptyResourceVector, unitResourceVector } from "@/lib/engine/resources";
import { runDirectedLogisticsProcessor, type DirectedLogisticsProcessorParams } from "@/lib/tick/processors/directed-logistics";
import { DIRECTED_LOGISTICS } from "@/lib/constants/directed-logistics";
import type { RouteBookerFor } from "@/lib/engine/directed-logistics";
import { createRouteBooker, buildLaneNetwork, type LaneLoad } from "@/lib/engine/lane-routing";
import { LOGISTICS_INTERVAL } from "@/lib/constants/tick-cadence";
import { consumptionRate } from "@/lib/engine/physical-economy";
import {
  computeSystemLabourSnapshot, inputDemandForGood, buildingProduction,
} from "@/lib/engine/industry";
import { brakeKnee } from "@/lib/engine/tick";
import { ECONOMY_SIM_PARAMS } from "@/lib/constants/economy";
import type { SystemLogisticsRow } from "@/lib/tick/world/directed-logistics-world";

// ── Test-only RouteBookerFor fakes ────────────────────────────────
//
// `fuelTotal` is fixed at 0 for every placement in these fakes (rather than tied to placed
// quantity), so `freightArrivalTick` resolves to the dispatch tick itself for every test that
// doesn't care about transit delay — the delay formula gets its own dedicated tests below.

const NO_LOADS = (): ReadonlyMap<string, LaneLoad> => new Map();

/** Every hauler gets its own booker (no shared congestion) at a flat per-unit `cost`. `null` from
 *  `cost` closes the route (unreachable), matching a real booker's `priceFrom`/`routeAndBook`.
 *  `reachableFrom` mirrors `cost !== null` too — these fakes carry no congestion, so reachability
 *  and live pricing never diverge the way a real saturated lane would. */
function flatBookerFor(cost: (from: string, to: string) => number | null): DirectedLogisticsProcessorParams["bookerFor"] {
  return (): RouteBookerFor => ({
    priceFrom: (sinkId: string) => (donorId: string) => cost(donorId, sinkId),
    reachableFrom: (sinkId: string) => (donorId: string) => cost(donorId, sinkId) !== null,
    routeAndBook: (from: string, to: string, quantity: number) => {
      if (from === to || quantity <= 0) return null;
      const perUnit = cost(from, to);
      if (perUnit === null) return null;
      return {
        placements: [{ quantity, edges: [`${from}->${to}`], perUnit, fuelTotal: 0 }],
        blocked: [],
      };
    },
  });
}

function mintIdFactory(prefix = "haul"): () => string {
  let n = 0;
  return () => `${prefix}-${n++}`;
}

/** The params every test starts from — `interval`, a flat-cost booker, no lane-load reporting, no
 *  scheduled-inbound baseline, and a fresh id minter. Individual tests override what they need. */
function baseParams(
  cost: (from: string, to: string) => number | null,
  overrides?: Partial<DirectedLogisticsProcessorParams>,
): DirectedLogisticsProcessorParams {
  return {
    interval: LOGISTICS_INTERVAL,
    bookerFor: flatBookerFor(cost),
    laneLoads: NO_LOADS,
    mintId: mintIdFactory(),
    ...overrides,
  };
}

describe("MemoryDirectedLogisticsWorld", () => {
  it("groups systems by faction key (null = independents)", async () => {
    const world = new MemoryDirectedLogisticsWorld([
      { systemId: "A", factionId: "f1", population: 10, buildings: {}, yields: emptyResourceVector(), extractionEff: unitResourceVector(), markets: [] },
      { systemId: "B", factionId: null, population: 5, buildings: {}, yields: emptyResourceVector(), extractionEff: unitResourceVector(), markets: [] },
    ]);
    const keys = await world.getFactionShardKeys();
    expect(new Set(keys)).toEqual(new Set(["f1", null]));
    const f1 = await world.getSystemsForFactions(["f1"]);
    expect(f1.map((s) => s.systemId)).toEqual(["A"]);
  });

  it("applies stock updates and appends pending arrivals", async () => {
    const world = new MemoryDirectedLogisticsWorld([]);
    await world.applyMarketUpdates([{ id: "m1", stock: 42 }]);
    await world.appendPendingArrivals([{
      id: "haul-0", factionId: "f1", fromSystemId: "A", toSystemId: "B", goodId: "g",
      quantity: 8, dispatchTick: 1, arrivalTick: 2, routeEdges: ["A|B"], leg: "outbound",
    }]);
    expect(world.stockUpdates.get("m1")).toBe(42);
    expect(world.pendingArrivals).toHaveLength(1);
  });

  it("writes lane load updates, one entry per lane", async () => {
    const world = new MemoryDirectedLogisticsWorld([]);
    await world.applyLaneLoadUpdates([
      { key: "A|B", bookedLoad: 5, blockedVolume: 0 },
      { key: "B|C", bookedLoad: 0, blockedVolume: 0 },
    ]);
    expect(world.laneUpdates.get("A|B")).toEqual({ bookedLoad: 5, blockedVolume: 0 });
    expect(world.laneUpdates.get("B|C")).toEqual({ bookedLoad: 0, blockedVolume: 0 });
  });

  it("records an unserved-shortfall level and a served row's zero as distinct entries — neither is dropped", async () => {
    // 0 is a real assessment ("this run found the row servable"), not an absence: the world layer
    // reads it to DELETE a stale level, so an adapter that skipped zeros would silently strand one.
    const world = new MemoryDirectedLogisticsWorld([]);
    await world.applyUnservedShortfallUpdates([
      { id: "m1", unservedShortfall: 38 },
      { id: "m2", unservedShortfall: 0 },
    ]);
    expect(world.unservedShortfallUpdates.get("m1")).toBe(38);
    expect(world.unservedShortfallUpdates.get("m2")).toBe(0);
    expect(world.unservedShortfallUpdates.has("m3")).toBe(false);
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
// budget = 2 systems × 200 pop × GENERATION_PER_POP.
// engine quantity=min(shortfall 38, drawable 47, affordable) — every "ample budget" test below uses
// a route cost cheap enough that GENERATION_PER_POP's re-denomination never binds it; see the
// dedicated budget-ledger tests for the cases where it does.
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
  it("dispatches staple surplus toward a deficit system: donor debited immediately, destination NOT credited on the dispatch tick", async () => {
    const systems = [
      {
        systemId: "A", factionId: "f1", population: 200, buildings: {},
        yields: emptyResourceVector(), extractionEff: unitResourceVector(), markets: [market("mA", "food", 95, 20)],
      },
      {
        systemId: "B", factionId: "f1", population: 200, buildings: {},
        yields: emptyResourceVector(), extractionEff: unitResourceVector(), markets: [market("mB", "food", 10, 20)],
      },
    ];
    const world = new MemoryDirectedLogisticsWorld(systems);
    await runDirectedLogisticsProcessor(world, { tick: DUE_TICK }, baseParams(() => 1));
    expect(world.pendingArrivals).toHaveLength(1);
    expect(world.pendingArrivals[0]).toMatchObject({ fromSystemId: "A", toSystemId: "B", goodId: "food", leg: "outbound" });
    expect(world.pendingArrivals[0].quantity).toBeGreaterThan(0);
    // Donor's stock is debited at dispatch...
    expect(world.stockUpdates.has("mA")).toBe(true);
    // ...but the destination is NOT — nothing credits it until the arrivals stage drains the ledger.
    expect(world.stockUpdates.has("mB")).toBe(false);
  });

  it("mints a fresh id per dispatched haul via the supplied mintId", async () => {
    const systems = [
      { systemId: "A1", factionId: "f1", population: 200, buildings: {}, yields: emptyResourceVector(), extractionEff: unitResourceVector(), markets: [market("mA1", "food", 70, 20)] },
      { systemId: "A2", factionId: "f1", population: 200, buildings: {}, yields: emptyResourceVector(), extractionEff: unitResourceVector(), markets: [market("mA2", "food", 70, 20)] },
      { systemId: "B", factionId: "f1", population: 200, buildings: {}, yields: emptyResourceVector(), extractionEff: unitResourceVector(), markets: [market("mB", "food", 10, 20)] },
    ];
    const world = new MemoryDirectedLogisticsWorld(systems);
    await runDirectedLogisticsProcessor(world, { tick: DUE_TICK }, baseParams(() => 1, { mintId: mintIdFactory("mint") }));
    expect(world.pendingArrivals).toHaveLength(2);
    expect(new Set(world.pendingArrivals.map((a) => a.id))).toEqual(new Set(["mint-0", "mint-1"]));
  });

  it("the ledger row's arrivalTick equals the freight formula over the placed path", async () => {
    // fuelTotal 17, FREIGHT_SPEED (lib/constants/lanes.ts) — arrivalTick = tick + round(17 / speed).
    const { LANES } = await import("@/lib/constants/lanes");
    const { freightArrivalTick } = await import("@/lib/engine/freight");
    const FUEL_TOTAL = 17;
    const bookerFor = (): RouteBookerFor => ({
      priceFrom: () => () => 1,
      reachableFrom: () => () => true,
      routeAndBook: (from, to, quantity) => ({
        placements: [{ quantity, edges: [`${from}->${to}`], perUnit: 1, fuelTotal: FUEL_TOTAL }],
        blocked: [],
      }),
    });
    const systems = [
      { systemId: "A", factionId: "f1", population: 200, buildings: {}, yields: emptyResourceVector(), extractionEff: unitResourceVector(), markets: [market("mA", "food", 95, 20)] },
      { systemId: "B", factionId: "f1", population: 200, buildings: {}, yields: emptyResourceVector(), extractionEff: unitResourceVector(), markets: [market("mB", "food", 10, 20)] },
    ];
    const world = new MemoryDirectedLogisticsWorld(systems);
    const TICK = 0; // must land on a cycle-start boundary (interval defaults to LOGISTICS_INTERVAL)
    await runDirectedLogisticsProcessor(world, { tick: TICK }, baseParams(() => 1, { bookerFor }));
    expect(world.pendingArrivals).toHaveLength(1);
    expect(world.pendingArrivals[0].dispatchTick).toBe(TICK);
    expect(world.pendingArrivals[0].arrivalTick).toBe(freightArrivalTick(TICK, FUEL_TOTAL, LANES.FREIGHT_SPEED));
    expect(world.pendingArrivals[0].arrivalTick).toBeGreaterThan(TICK); // the fixture premise: a real, positive delay
  });

  it("dispatches for independents (factionId null) exactly as it does for factions", async () => {
    const systems = [
      { systemId: "A", factionId: null, population: 200, buildings: {}, yields: emptyResourceVector(), extractionEff: unitResourceVector(), markets: [market("mA", "food", 95, 20)] },
      { systemId: "B", factionId: null, population: 200, buildings: {}, yields: emptyResourceVector(), extractionEff: unitResourceVector(), markets: [market("mB", "food", 10, 20)] },
    ];
    const world = new MemoryDirectedLogisticsWorld(systems);
    await runDirectedLogisticsProcessor(world, { tick: DUE_TICK }, baseParams(() => 1));
    expect(world.pendingArrivals).toHaveLength(1);
    expect(world.pendingArrivals[0]).toMatchObject({ factionId: null, fromSystemId: "A", toSystemId: "B" });
  });

  it("writes every network lane's load back, zero for one nothing booked this run", async () => {
    const network = buildLaneNetwork(
      [
        { fromSystemId: "A", toSystemId: "B", fuelCost: 1 },
        { fromSystemId: "B", toSystemId: "A", fuelCost: 1 },
        { fromSystemId: "X", toSystemId: "Y", fuelCost: 1 },
        { fromSystemId: "Y", toSystemId: "X", fuelCost: 1 },
      ],
      [
        { key: "A|B", aId: "A", bId: "B", level: 0, bookedLoad: 99, blockedVolume: 0, idleCycles: 0 },
        { key: "X|Y", aId: "X", bId: "Y", level: 0, bookedLoad: 0, blockedVolume: 0, idleCycles: 0 },
      ],
      () => 1000,
    );
    const laneBooker = createRouteBooker(network, { congestionMax: 3, catchUp: 1 });
    const systems = [
      { systemId: "A", factionId: "f1", population: 200, buildings: {}, yields: emptyResourceVector(), extractionEff: unitResourceVector(), markets: [market("mA", "food", 95, 20)] },
      { systemId: "B", factionId: "f1", population: 200, buildings: {}, yields: emptyResourceVector(), extractionEff: unitResourceVector(), markets: [market("mB", "food", 10, 20)] },
    ];
    const world = new MemoryDirectedLogisticsWorld(systems);
    await runDirectedLogisticsProcessor(world, { tick: DUE_TICK }, {
      interval: LOGISTICS_INTERVAL,
      bookerFor: (factionKey) => laneBooker.forHauler(() => true, factionKey),
      laneLoads: () => laneBooker.loads(),
      mintId: mintIdFactory(),
    });
    // A|B was booked by this run's own haul; X|Y carries nobody's traffic this run — the network's
    // OWN previous-run figure (`bookedLoad: 0` in the fixture above, already what a fresh
    // `createRouteBooker` starts at) is what a genuinely unused lane reads, distinct from a lane
    // this run actually used.
    expect(world.laneUpdates.get("A|B")?.bookedLoad).toBeGreaterThan(0);
    expect(world.laneUpdates.get("X|Y")).toEqual({ bookedLoad: 0, blockedVolume: 0 });
  });

  it("the faction matched first books first on a shared saturable lane", async () => {
    // D1 (aFaction) and D2 (bFaction) each ship toward their own sink through a shared Hub, and
    // BOTH paths cross the same Hub|Bottleneck edge, capacity 10 — the one lane genuinely shared
    // between the two factions' hauls; every other edge is ample. Both factions' shortfalls (38
    // each) exceed the choke's capacity, so whichever faction is matched first takes the whole 10
    // and the other is blocked entirely — a single processor run, one faction group per key,
    // exercising the real ascending-id ("aFaction" before "bFaction") ordering internally.
    const network = buildLaneNetwork(
      [
        { fromSystemId: "D1", toSystemId: "Hub", fuelCost: 1 }, { fromSystemId: "Hub", toSystemId: "D1", fuelCost: 1 },
        { fromSystemId: "D2", toSystemId: "Hub", fuelCost: 1 }, { fromSystemId: "Hub", toSystemId: "D2", fuelCost: 1 },
        { fromSystemId: "Hub", toSystemId: "Bottleneck", fuelCost: 1 }, { fromSystemId: "Bottleneck", toSystemId: "Hub", fuelCost: 1 },
        { fromSystemId: "Bottleneck", toSystemId: "SinkA", fuelCost: 1 }, { fromSystemId: "SinkA", toSystemId: "Bottleneck", fuelCost: 1 },
        { fromSystemId: "Bottleneck", toSystemId: "SinkB", fuelCost: 1 }, { fromSystemId: "SinkB", toSystemId: "Bottleneck", fuelCost: 1 },
      ],
      [
        { key: "D1|Hub", aId: "D1", bId: "Hub", level: 0, bookedLoad: 0, blockedVolume: 0, idleCycles: 0 },
        { key: "D2|Hub", aId: "D2", bId: "Hub", level: 0, bookedLoad: 0, blockedVolume: 0, idleCycles: 0 },
        { key: "Bottleneck|Hub", aId: "Bottleneck", bId: "Hub", level: 0, bookedLoad: 0, blockedVolume: 0, idleCycles: 0 },
        { key: "Bottleneck|SinkA", aId: "Bottleneck", bId: "SinkA", level: 0, bookedLoad: 0, blockedVolume: 0, idleCycles: 0 },
        { key: "Bottleneck|SinkB", aId: "Bottleneck", bId: "SinkB", level: 0, bookedLoad: 0, blockedVolume: 0, idleCycles: 0 },
      ],
      (lane) => (lane.key === "Bottleneck|Hub" ? 10 : 100_000),
    );
    const laneBooker = createRouteBooker(network, { congestionMax: 3, catchUp: 1 });
    const bookerFor = (factionKey: string | null): RouteBookerFor => laneBooker.forHauler(() => true, factionKey);

    // bFaction's rows are listed FIRST (reverse of ascending-id order) — a processor that trusted
    // row/insertion order rather than explicitly sorting faction keys would match bFaction first
    // and get this test's expectations backwards.
    const world = new MemoryDirectedLogisticsWorld([
      { systemId: "D2", factionId: "bFaction", population: 0, buildings: {}, yields: emptyResourceVector(), extractionEff: unitResourceVector(), markets: [market("mD2", "food", 100_000, 0)] },
      { systemId: "SinkB", factionId: "bFaction", population: 200, buildings: {}, yields: emptyResourceVector(), extractionEff: unitResourceVector(), markets: [market("mSinkB", "food", 10, 20)] },
      { systemId: "D1", factionId: "aFaction", population: 0, buildings: {}, yields: emptyResourceVector(), extractionEff: unitResourceVector(), markets: [market("mD1", "food", 100_000, 0)] },
      { systemId: "SinkA", factionId: "aFaction", population: 200, buildings: {}, yields: emptyResourceVector(), extractionEff: unitResourceVector(), markets: [market("mSinkA", "food", 10, 20)] },
    ]);
    await runDirectedLogisticsProcessor(world, { tick: DUE_TICK }, {
      interval: LOGISTICS_INTERVAL,
      bookerFor,
      laneLoads: () => laneBooker.loads(),
      mintId: mintIdFactory(),
    });

    const aDispatched = world.pendingArrivals.filter((a) => a.toSystemId === "SinkA").reduce((n, a) => n + a.quantity, 0);
    const bDispatched = world.pendingArrivals.filter((a) => a.toSystemId === "SinkB").reduce((n, a) => n + a.quantity, 0);
    // aFaction, matched first, takes the whole choke capacity; bFaction, matched second, gets none
    // of it — the choke is already saturated by the time bFaction's own fill runs.
    expect(aDispatched).toBeCloseTo(10, 6);
    expect(bDispatched).toBe(0);
    const choke = laneBooker.loads().get("Bottleneck|Hub");
    expect(choke?.bookedLoad).toBeCloseTo(10, 6);
    expect(choke?.blockedVolume).toBeGreaterThan(0); // bFaction's shortfall found no room left
  });

  it("reports work performed by the faction, equal to the planned transfer cost", async () => {
    const systems = [
      { systemId: "A", factionId: "f1", population: 200, buildings: {}, yields: emptyResourceVector(), extractionEff: unitResourceVector(), markets: [market("mA", "food", 95, 20)] },
      { systemId: "B", factionId: "f1", population: 200, buildings: {}, yields: emptyResourceVector(), extractionEff: unitResourceVector(), markets: [market("mB", "food", 10, 20)] },
    ];
    const world = new MemoryDirectedLogisticsWorld(systems);
    const result = await runDirectedLogisticsProcessor(world, { tick: DUE_TICK }, baseParams(() => 1));
    // routeCost is a flat 1/unit, so the planned cost equals the dispatched quantity.
    expect(result.workPerformedByFaction?.get("f1")).toBeCloseTo(world.pendingArrivals[0].quantity, 6);
  });

  it("reports the per-faction haul budget beside the work performed", async () => {
    const systems = [
      { systemId: "A", factionId: "f1", population: 200, buildings: {}, yields: emptyResourceVector(), extractionEff: unitResourceVector(), markets: [market("mA", "food", 95, 20)] },
      { systemId: "B", factionId: "f1", population: 200, buildings: {}, yields: emptyResourceVector(), extractionEff: unitResourceVector(), markets: [market("mB", "food", 10, 20)] },
    ];
    const world = new MemoryDirectedLogisticsWorld(systems);
    const result = await runDirectedLogisticsProcessor(world, { tick: DUE_TICK }, baseParams(() => 1));
    const budget = result.logisticsBudget?.get("f1");
    expect(budget?.total).toBeCloseTo(2 * 200 * DIRECTED_LOGISTICS.GENERATION_PER_POP, 6);
    expect(budget?.spent).toBeCloseTo(38, 6);
    expect(budget?.fundingBoundCount).toBe(0);
    expect(budget?.budgetSkipped).toBe(0);
  });

  it("counts a multi-donor fan-out's spend once, as the sum of its draws", async () => {
    // One deficit (shortfall 38) filled from two donors of drawable 22 each (stock 70 − target 48),
    // so the run dispatches two pending-arrival rows (draws of 22 and 16). Spent must equal the
    // summed draw costs — 38 at route cost 1 — and agree with the treasury's work figure; a ledger
    // that also counted per-row would read 76 and bill the faction twice for one haul.
    const systems = [
      { systemId: "A1", factionId: "f1", population: 200, buildings: {}, yields: emptyResourceVector(), extractionEff: unitResourceVector(), markets: [market("mA1", "food", 70, 20)] },
      { systemId: "A2", factionId: "f1", population: 200, buildings: {}, yields: emptyResourceVector(), extractionEff: unitResourceVector(), markets: [market("mA2", "food", 70, 20)] },
      { systemId: "B", factionId: "f1", population: 200, buildings: {}, yields: emptyResourceVector(), extractionEff: unitResourceVector(), markets: [market("mB", "food", 10, 20)] },
    ];
    const world = new MemoryDirectedLogisticsWorld(systems);
    const result = await runDirectedLogisticsProcessor(world, { tick: DUE_TICK }, baseParams(() => 1));
    expect(world.pendingArrivals).toHaveLength(2);
    const budget = result.logisticsBudget?.get("f1");
    expect(budget?.total).toBeCloseTo(3 * 200 * DIRECTED_LOGISTICS.GENERATION_PER_POP, 6);
    expect(budget?.spent).toBeCloseTo(38, 6);
    expect(result.workPerformedByFaction?.get("f1")).toBeCloseTo(38, 6);
    // Conservation across the fan-out: each donor debited by exactly its own draw. The destination
    // is never touched at dispatch — see the dedicated no-destination-credit test above.
    expect(world.pendingArrivals[0]).toMatchObject({ fromSystemId: "A1", quantity: 22 });
    expect(world.pendingArrivals[1]).toMatchObject({ fromSystemId: "A2", quantity: 16 });
    expect(world.stockUpdates.get("mA1")).toBeCloseTo(48, 6);
    expect(world.stockUpdates.get("mA2")).toBeCloseTo(54, 6);
    expect(world.stockUpdates.has("mB")).toBe(false);
  });

  it("hauls for independents but keeps them off the budget ledger", async () => {
    // The ledger mirrors workPerformedByFaction: faction-owned groups only. Independents'
    // hauls still dispatch — their haul just isn't billed or counted into budgetSpentFrac.
    const systems = [
      { systemId: "A", factionId: null, population: 200, buildings: {}, yields: emptyResourceVector(), extractionEff: unitResourceVector(), markets: [market("mA", "food", 95, 20)] },
      { systemId: "B", factionId: null, population: 200, buildings: {}, yields: emptyResourceVector(), extractionEff: unitResourceVector(), markets: [market("mB", "food", 10, 20)] },
      { systemId: "C", factionId: "f1", population: 200, buildings: {}, yields: emptyResourceVector(), extractionEff: unitResourceVector(), markets: [market("mC", "food", 95, 20)] },
      { systemId: "D", factionId: "f1", population: 200, buildings: {}, yields: emptyResourceVector(), extractionEff: unitResourceVector(), markets: [market("mD", "food", 10, 20)] },
    ];
    const world = new MemoryDirectedLogisticsWorld(systems);
    const result = await runDirectedLogisticsProcessor(world, { tick: DUE_TICK }, baseParams(() => 1));
    expect(world.pendingArrivals).toHaveLength(2);
    expect(world.pendingArrivals.some((a) => a.fromSystemId === "A" && a.toSystemId === "B")).toBe(true);
    expect(result.logisticsBudget?.size).toBe(1);
    expect(result.logisticsBudget?.get("f1")?.total).toBeCloseTo(2 * 200 * DIRECTED_LOGISTICS.GENERATION_PER_POP, 6);
  });

  it("counts funding-bound deficits in the budget ledger, including budgetSkipped", async () => {
    // funded 0 → a zero budget the one reachable deficit cannot draw against: total 0, spent 0,
    // one funding-bound record, and the fill's one unaffordable-draw skip.
    const systems = [
      { systemId: "A", factionId: "f1", population: 200, buildings: {}, yields: emptyResourceVector(), extractionEff: unitResourceVector(), markets: [market("mA", "food", 95, 20)] },
      { systemId: "B", factionId: "f1", population: 200, buildings: {}, yields: emptyResourceVector(), extractionEff: unitResourceVector(), markets: [market("mB", "food", 10, 20)] },
    ];
    const world = new MemoryDirectedLogisticsWorld(systems);
    const result = await runDirectedLogisticsProcessor(world, { tick: DUE_TICK }, baseParams(() => 1, {
      fundingByFaction: new Map([["f1", 0]]),
    }));
    expect(result.logisticsBudget?.get("f1")).toEqual({ total: 0, spent: 0, fundingBoundCount: 1, budgetSkipped: 1 });
  });

  it("dispatches a deficit's exact shortfall in one haul — never more", async () => {
    // Regression for the catch-up overshoot: a single delivery is a level-fill toward the
    // cycles-of-supply target (logisticsTarget), NOT a rate that scales with the shard interval.
    // mB: stock 10, target 48 → shortfall 38 exactly, with ample donor (drawable 47) and budget.
    const systems = [
      { systemId: "A", factionId: "f1", population: 200, buildings: {}, yields: emptyResourceVector(), extractionEff: unitResourceVector(), markets: [market("mA", "food", 95, 20)] },
      { systemId: "B", factionId: "f1", population: 200, buildings: {}, yields: emptyResourceVector(), extractionEff: unitResourceVector(), markets: [market("mB", "food", 10, 20)] },
    ];
    const world = new MemoryDirectedLogisticsWorld(systems);
    await runDirectedLogisticsProcessor(world, { tick: DUE_TICK }, baseParams(() => 1));
    const dispatched = world.pendingArrivals[0].quantity;
    expect(dispatched).toBeCloseTo(FOOD_TARGET - 10, 6); // exactly the shortfall — not more
    // conservation: donor lost exactly what was dispatched
    expect(world.stockUpdates.get("mA")).toBeCloseTo(95 - dispatched, 6);
  });

  it("dispatches a fractional transfer without quantizing (scale-invariance guard)", async () => {
    // The engine matcher works in continuous goods units; the processor must dispatch the
    // transfer as-is. A fractional deficit stock (10.3) makes the shortfall fractional
    // (48 − 10.3 = 37.7); flooring here would drop it to 37. That lost unit is ~2% at
    // these magnitudes but a large fraction at ECONOMY_SCALE=1 and negligible at 100 —
    // the exact scale-variance this guards. Budget (population-scaled) and drawable (47)
    // both exceed the shortfall, so the shortfall is the binding, fractional quantity.
    const systems = [
      { systemId: "A", factionId: "f1", population: 200, buildings: {}, yields: emptyResourceVector(), extractionEff: unitResourceVector(), markets: [market("mA", "food", 95, 20)] },
      { systemId: "B", factionId: "f1", population: 200, buildings: {}, yields: emptyResourceVector(), extractionEff: unitResourceVector(), markets: [market("mB", "food", 10.3, 20)] },
    ];
    const world = new MemoryDirectedLogisticsWorld(systems);
    await runDirectedLogisticsProcessor(world, { tick: DUE_TICK }, baseParams(() => 1));
    expect(world.pendingArrivals[0].quantity).toBeCloseTo(37.7, 6); // the fraction survives — NOT 37
    expect(world.stockUpdates.get("mA")).toBeCloseTo(95 - 37.7, 6);
  });

  it("does nothing for an empty world", async () => {
    // empty world → getFactionShardKeys() returns [] → factionKeys.length === 0 → early return (before shardRange)
    const world = new MemoryDirectedLogisticsWorld([]);
    await runDirectedLogisticsProcessor(world, { tick: 7 }, baseParams(() => 1));
    expect(world.pendingArrivals).toHaveLength(0);
  });

  it("moves nothing on an off-boundary tick (cycle start)", async () => {
    // Same surplus(mA)+deficit(mB) as the happy path, but tick=1: cycleStartShard(1, 1, 24) is an
    // empty window off the cycle boundary, so NO faction redistributes — distinct from the
    // empty-world early return.
    const systems = [
      { systemId: "A", factionId: "f1", population: 200, buildings: {}, yields: emptyResourceVector(), extractionEff: unitResourceVector(), markets: [market("mA", "food", 95, 20)] },
      { systemId: "B", factionId: "f1", population: 200, buildings: {}, yields: emptyResourceVector(), extractionEff: unitResourceVector(), markets: [market("mB", "food", 10, 20)] },
    ];
    const world = new MemoryDirectedLogisticsWorld(systems);
    await runDirectedLogisticsProcessor(world, { tick: 1 }, baseParams(() => 1));
    expect(world.pendingArrivals).toHaveLength(0);
    expect(world.stockUpdates.size).toBe(0);
    expect(world.fundingBoundUpdates.size).toBe(0);
    expect(world.laneUpdates.size).toBe(0);
  });

  it("haul budget scales with the interval; deliveries stay gap-fills", async () => {
    // Budget-bound: an ample donor and an expensive route, so the per-cycle work budget
    // (Σ pop × generation) binds well before the 38-unit gap does. Halving the interval halves the
    // budget, so it moves half as much per cycle (same wall-clock haul capacity when run twice as
    // often).
    const EXPENSIVE = 2000;
    const budgetBound = () => [
      { systemId: "A", factionId: "f1", population: FIXTURE_POP, buildings: {}, yields: emptyResourceVector(), extractionEff: unitResourceVector(), markets: [market("mA", "food", 100000, 0)] },
      { systemId: "B", factionId: "f1", population: FIXTURE_POP, buildings: {}, yields: emptyResourceVector(), extractionEff: unitResourceVector(), markets: [market("mB", "food", 10, 0)] },
    ];
    const movedAt = async (interval: number): Promise<number> => {
      const world = new MemoryDirectedLogisticsWorld(budgetBound());
      await runDirectedLogisticsProcessor(world, { tick: 0 }, baseParams(() => EXPENSIVE, { interval }));
      return world.pendingArrivals[0].quantity;
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
        { systemId: "A", factionId: "f1", population: 200, buildings: {}, yields: emptyResourceVector(), extractionEff: unitResourceVector(), markets: [market("mA", "food", 95, 20)] },
        { systemId: "B", factionId: "f1", population: 200, buildings: {}, yields: emptyResourceVector(), extractionEff: unitResourceVector(), markets: [market("mB", "food", 10, 20)] },
      ];
      const world = new MemoryDirectedLogisticsWorld(systems);
      await runDirectedLogisticsProcessor(world, { tick: 0 }, baseParams(() => 1, { interval }));
      return world.pendingArrivals[0].quantity;
    };
    expect(await gapFill(24)).toBeCloseTo(38, 6);
    expect(await gapFill(12)).toBeCloseTo(38, 6); // identical at half the interval — gap-fills don't scale
  });

  it("scales the haul budget by the faction's funded fraction (0 → no dispatches)", async () => {
    const mk = () => [
      { systemId: "A", factionId: "f1", population: 200, buildings: {}, yields: emptyResourceVector(), extractionEff: unitResourceVector(), markets: [market("mA", "food", 95, 20)] },
      { systemId: "B", factionId: "f1", population: 200, buildings: {}, yields: emptyResourceVector(), extractionEff: unitResourceVector(), markets: [market("mB", "food", 10, 20)] },
    ];
    // funded 0 → generation × 0 = no work budget → nothing dispatches.
    const gated = new MemoryDirectedLogisticsWorld(mk());
    await runDirectedLogisticsProcessor(gated, { tick: DUE_TICK }, baseParams(() => 1, {
      fundingByFaction: new Map([["f1", 0]]),
    }));
    expect(gated.pendingArrivals).toHaveLength(0);
    expect(gated.fundingBoundUpdates.get("mA")).toBe(true);
    expect(gated.fundingBoundUpdates.get("mB")).toBe(true);
    // Reachable drawable (47) comfortably covers the shortfall (38) — only the zeroed budget stops
    // the fill, so this is funding-bound WITHOUT being structural: no level is recorded at all, not
    // even a zero (the row had none before, so there is nothing to clear and nothing to write).
    expect(gated.unservedShortfallUpdates.has("mB")).toBe(false);

    // A faction missing from the map is ungated — identical to no map at all.
    const ungated = new MemoryDirectedLogisticsWorld(mk());
    await runDirectedLogisticsProcessor(ungated, { tick: DUE_TICK }, baseParams(() => 1, {
      fundingByFaction: new Map([["other", 0]]),
    }));
    expect(ungated.pendingArrivals).toHaveLength(1);
  });

  it("writes only changed assessments and clears a recovered funding-bound marker", async () => {
    const systems = [
      {
        systemId: "A", factionId: "f1", population: 200, buildings: {},
        yields: emptyResourceVector(), extractionEff: unitResourceVector(), markets: [
          market("mA", "food", 95, 20),
          market("mOther", "ore", 40, 20),
        ],
      },
      {
        systemId: "B", factionId: "f1", population: 200, buildings: {},
        yields: emptyResourceVector(), extractionEff: unitResourceVector(), markets: [market("mB", "food", 10, 20)],
      },
    ];
    const world = new MemoryDirectedLogisticsWorld(systems);
    await runDirectedLogisticsProcessor(world, { tick: DUE_TICK }, baseParams(() => 1, {
      fundingByFaction: new Map([["f1", 0]]),
    }));
    expect(world.fundingBoundUpdates.get("mA")).toBe(true);
    expect(world.fundingBoundUpdates.get("mB")).toBe(true);
    expect(world.fundingBoundUpdates.has("mOther")).toBe(false);
    expect(world.fundingBoundUpdates.size).toBe(2);

    const recoveredWorld = new MemoryDirectedLogisticsWorld([
      {
        systemId: "A", factionId: "f1", population: 200, buildings: {},
        yields: emptyResourceVector(), extractionEff: unitResourceVector(), markets: [
          market("mA", "food", 95, 20, true),
          market("mOther", "ore", 40, 20),
        ],
      },
      {
        systemId: "B", factionId: "f1", population: 200, buildings: {},
        yields: emptyResourceVector(), extractionEff: unitResourceVector(), markets: [market("mB", "food", 10, 20, true)],
      },
    ]);
    await runDirectedLogisticsProcessor(recoveredWorld, { tick: DUE_TICK }, baseParams(() => 1));
    expect(recoveredWorld.fundingBoundUpdates.get("mA")).toBe(false);
    expect(recoveredWorld.fundingBoundUpdates.get("mB")).toBe(false);
    expect(recoveredWorld.fundingBoundUpdates.has("mOther")).toBe(false);
    expect(recoveredWorld.fundingBoundUpdates.size).toBe(2);
  });

  it("marks a structurally unservable deficit and clears it once a donor becomes reachable", async () => {
    // Run 1: B alone — no other system in the match holds food at all, so no reachable donor exists
    // regardless of budget. Structural, and (unlike a funding-bound deficit) not a matter of money.
    const isolated = new MemoryDirectedLogisticsWorld([
      { systemId: "B", factionId: "f1", population: 200, buildings: {}, yields: emptyResourceVector(), extractionEff: unitResourceVector(), markets: [market("mB", "food", 10, 20)] },
    ]);
    await runDirectedLogisticsProcessor(isolated, { tick: DUE_TICK }, baseParams(() => 1));
    // The level IS the classification: shortfall = target(48) − stock(10), strictly positive.
    expect(isolated.unservedShortfallUpdates.get("mB")).toBe(38);
    // Never budget-stopped at all (no candidate donor even entered the draw loop), so the funding-
    // bound assessment is unchanged from its prior absence — no write, not an explicit false.
    expect(isolated.fundingBoundUpdates.has("mB")).toBe(false);

    // Run 2: the same deficit, now carrying the prior level, with an ample donor added and
    // reachable. The shortfall (38) is well inside the donor's drawable (47) and the budget, so the
    // deficit is fully served — the level must explicitly clear to 0, not merely go unwritten: an
    // unwritten row keeps its stale 38 through the world-layer merge.
    const recovered = new MemoryDirectedLogisticsWorld([
      { systemId: "A", factionId: "f1", population: 200, buildings: {}, yields: emptyResourceVector(), extractionEff: unitResourceVector(), markets: [market("mA", "food", 95, 20)] },
      { systemId: "B", factionId: "f1", population: 200, buildings: {}, yields: emptyResourceVector(), extractionEff: unitResourceVector(), markets: [{ ...market("mB", "food", 10, 20), unservedShortfall: 38 }] },
    ]);
    await runDirectedLogisticsProcessor(recovered, { tick: DUE_TICK }, baseParams(() => 1));
    expect(recovered.unservedShortfallUpdates.get("mB")).toBe(0);
    // A donor is never a candidate for this reading — it had none and gains none.
    expect(recovered.unservedShortfallUpdates.has("mA")).toBe(false);
  });

  it("keeps unreachable pairs unmarked", async () => {
    const systems = [
      { systemId: "A", factionId: "f1", population: 0, buildings: {}, yields: emptyResourceVector(), extractionEff: unitResourceVector(), markets: [market("mA", "food", 95, 20)] },
      { systemId: "B", factionId: "f1", population: 0, buildings: {}, yields: emptyResourceVector(), extractionEff: unitResourceVector(), markets: [market("mB", "food", 10, 20)] },
    ];
    const world = new MemoryDirectedLogisticsWorld(systems);
    await runDirectedLogisticsProcessor(world, { tick: DUE_TICK }, baseParams(() => null));
    expect(world.fundingBoundUpdates.size).toBe(0);
  });

  it("treats an assessed zero-output producer as a logistics sink despite nonzero capacity", async () => {
    const systems: SystemLogisticsRow[] = [
      {
        systemId: "A", factionId: "f1", population: 200,
        buildings: { food: 3 }, yields: emptyResourceVector(), extractionEff: unitResourceVector(),
        markets: [{ ...market("mA", "food", 10, 20), realisedProductionRate: 0 }],
      },
      {
        systemId: "B", factionId: "f1", population: 200,
        buildings: {}, yields: emptyResourceVector(), extractionEff: unitResourceVector(), markets: [market("mB", "food", 95, 20)],
      },
    ];
    const world = new MemoryDirectedLogisticsWorld(systems);
    await runDirectedLogisticsProcessor(world, { tick: DUE_TICK }, baseParams(() => 1));
    expect(world.pendingArrivals).toHaveLength(1);
    expect(world.pendingArrivals[0]).toMatchObject({ fromSystemId: "B", toSystemId: "A", goodId: "food" });
  });

  describe("the sink test counts scheduled inbound — a delivery already dispatched is not ordered twice", () => {
    it("suppresses a deficit whose want is already covered by in-flight goods", async () => {
      const systems = [
        { systemId: "A", factionId: "f1", population: 200, buildings: {}, yields: emptyResourceVector(), extractionEff: unitResourceVector(), markets: [market("mA", "food", 95, 20)] },
        { systemId: "B", factionId: "f1", population: 200, buildings: {}, yields: emptyResourceVector(), extractionEff: unitResourceVector(), markets: [market("mB", "food", 10, 20)] },
      ];
      const world = new MemoryDirectedLogisticsWorld(systems);
      // 38 already scheduled toward B|food — stock(10) + scheduledInbound(38) = 48 = target, so the
      // sink test reads B as balanced, not a deficit, and nothing new dispatches.
      await runDirectedLogisticsProcessor(world, { tick: DUE_TICK }, baseParams(() => 1, {
        scheduledInbound: new Map([["B|food", 38]]),
      }));
      expect(world.pendingArrivals).toHaveLength(0);
    });

    it("clamps dispatch against the destination's remaining pricing-band room, even when the matcher itself would plan more", async () => {
      // The matcher sizes a fill against `logisticsTarget` (WAREHOUSE_COVER × demand, here forced
      // via `honestUseRate` to 400, independent of the tiny `demandRate` that drives the PRICING
      // band) — it never reads the band's own `maxStock` at all. Setting `demandRate` small keeps
      // the band's `maxStock` (the pricing ceiling infrastructure supports) far below what the
      // matcher would happily plan, so the processor's own belt-and-braces clamp — not the
      // matcher's classification — is what actually limits the dispatched quantity.
      const { marketBandForRow } = await import("@/lib/engine/market-pricing");
      const { GOODS } = await import("@/lib/constants/goods");
      const sinkRow = { id: "mB", goodId: "food", stock: 0, anchorMult: 1, demandRate: 0.1, storageCapacity: 0, honestUseRate: 10 };
      const roomAvailable = marketBandForRow(sinkRow, GOODS.food).maxStock;
      const systems: SystemLogisticsRow[] = [
        {
          systemId: "A", factionId: "f1", population: 200, buildings: {},
          yields: emptyResourceVector(), extractionEff: unitResourceVector(),
          markets: [{ id: "mA", goodId: "food", stock: 100_000, anchorMult: 1, demandRate: 1000, storageCapacity: 0, honestUseRate: 1 }],
        },
        {
          systemId: "B", factionId: "f1", population: 200, buildings: {},
          yields: emptyResourceVector(), extractionEff: unitResourceVector(),
          markets: [sinkRow],
        },
      ];
      const world = new MemoryDirectedLogisticsWorld(systems);
      await runDirectedLogisticsProcessor(world, { tick: DUE_TICK }, baseParams(() => 1));
      expect(world.pendingArrivals).toHaveLength(1);
      // The matcher's own plan (shortfall 400, ample donor and budget) vastly exceeds the room —
      // the clamp is what actually bound this dispatch, not the matcher's own sizing.
      expect(world.pendingArrivals[0].quantity).toBeCloseTo(roomAvailable, 6);
      expect(world.pendingArrivals[0].quantity).toBeLessThan(400);
    });
  });

  describe("re-denominated GENERATION_PER_POP vacuity check", () => {
    // The whole point of the ×8.5 re-scale (see the constant's own docstring): a deficit sized so
    // the PRE-migration budget (population × the old GENERATION_PER_POP=5) would have left it
    // funding-bound against a representative NEW (lane-priced) route cost must NOT be funding-bound
    // under the actual, re-scaled constant — "rare, deliberate", not an ambient brake, restored at
    // the new cost level. `honestUseRate` sets `demand` directly (`good-market-state.ts`), so the
    // deficit's size is controlled independently of the population that funds the budget.
    const OLD_GENERATION_PER_POP = 5; // pre-migration value (scaleValue(5) — identity at vitest's ECONOMY_SCALE)
    const NEW_ROUTE_COST = 17; // the constant's own docstring worked figure for a typical new-regime haul
    const POP = 200;
    const SHORTFALL = 200; // sits strictly between the old and the new (×8.5) budget at NEW_ROUTE_COST

    function buildFixture(): SystemLogisticsRow[] {
      return [
        {
          systemId: "A", factionId: "f1", population: POP, buildings: {},
          yields: emptyResourceVector(), extractionEff: unitResourceVector(),
          markets: [{ id: "mA", goodId: "food", stock: 100_000, anchorMult: 1, demandRate: 1000, storageCapacity: 0, honestUseRate: 1 }],
        },
        {
          systemId: "B", factionId: "f1", population: POP, buildings: {},
          yields: emptyResourceVector(), extractionEff: unitResourceVector(),
          markets: [{
            id: "mB", goodId: "food", stock: 0, anchorMult: 1, demandRate: 1000, storageCapacity: 0,
            honestUseRate: SHORTFALL / DIRECTED_LOGISTICS.WAREHOUSE_COVER,
          }],
        },
      ];
    }

    it("is NOT funding-bound at the real, re-scaled constant", async () => {
      const world = new MemoryDirectedLogisticsWorld(buildFixture());
      await runDirectedLogisticsProcessor(world, { tick: DUE_TICK }, baseParams(() => NEW_ROUTE_COST));
      expect(world.fundingBoundUpdates.has("mB")).toBe(false);
    });

    it("[red-proof only] the SAME fixture IS funding-bound at the pre-migration budget — confirms the check can fail", async () => {
      // Simulates the OLD budget by scaling `funded` to the OLD/NEW ratio — the processor has no
      // other lever to set GENERATION_PER_POP per-call, and `funded` is exactly a multiplicative
      // scale on the same generation term (`systemLogisticsGeneration(pop) * catchUp * funded`).
      const world = new MemoryDirectedLogisticsWorld(buildFixture());
      await runDirectedLogisticsProcessor(world, { tick: DUE_TICK }, baseParams(() => NEW_ROUTE_COST, {
        fundingByFaction: new Map([["f1", OLD_GENERATION_PER_POP / DIRECTED_LOGISTICS.GENERATION_PER_POP]]),
      }));
      expect(world.fundingBoundUpdates.get("mB")).toBe(true);
    });
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
    // Scaled ×8.5 alongside GENERATION_PER_POP's own re-denomination (see that constant's
    // docstring) — this fixture's budget-bound premise (R1 gets a PARTIAL fill) depends on the
    // route cost and the budget moving together; leaving this at its pre-migration value would let
    // the ×8.5-larger budget clear R1's remainder in full.
    const ROUTE_COST = 10 * 8.5;

    function buildWorld(): MemoryDirectedLogisticsWorld {
      return new MemoryDirectedLogisticsWorld([
        {
          systemId: "D", factionId: "f1", population: 0, buildings: {},
          yields: emptyResourceVector(), extractionEff: unitResourceVector(),
          markets: [{ id: "mD", goodId: "ore", stock: 100_000, anchorMult: 1, demandRate: 1, storageCapacity: 0 }],
        },
        {
          systemId: "R1", factionId: "f1", population: METALS_POP, buildings: METALS_BUILDINGS,
          yields: emptyResourceVector(), extractionEff: unitResourceVector(),
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
          yields: emptyResourceVector(), extractionEff: unitResourceVector(),
          markets: [
            { id: "mR2ore", goodId: "ore", stock: 0, anchorMult: 1, demandRate: 1000, storageCapacity: 0, honestUseRate: oreWant },
          ],
        },
      ]);
    }

    const oreReceivedBy = (world: MemoryDirectedLogisticsWorld, systemId: string): number =>
      world.pendingArrivals.filter((a) => a.toSystemId === systemId && a.goodId === "ore")
        .reduce((sum, a) => sum + a.quantity, 0);

    it("services the higher-severity recipient first, live vs pinned to the retired anchor", async () => {
      const live = buildWorld();
      await runDirectedLogisticsProcessor(live, { tick: DUE_TICK }, baseParams(() => ROUTE_COST));
      // Live: R1's ore draw is braked to civilian-only (lower than R2's), so R2 outranks it and is
      // serviced in full first; the budget-limited remainder to R1 is a partial fill.
      expect(oreReceivedBy(live, "R2")).toBeCloseTo(SHORTFALL, 6);
      expect(oreReceivedBy(live, "R1")).toBeGreaterThan(0);
      expect(oreReceivedBy(live, "R1")).toBeLessThan(SHORTFALL);

      const pinned = buildWorld();
      await runDirectedLogisticsProcessor(pinned, { tick: DUE_TICK }, baseParams(() => ROUTE_COST, {
        drawBrakeCeiling: "anchor",
      }));
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
