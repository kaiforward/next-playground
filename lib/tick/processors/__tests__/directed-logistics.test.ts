import { describe, it, expect } from "vitest";
import { MemoryDirectedLogisticsWorld } from "@/lib/tick/adapters/memory/directed-logistics";
import { emptyResourceVector } from "@/lib/engine/resources";
import { runDirectedLogisticsProcessor } from "@/lib/tick/processors/directed-logistics";
import { DIRECTED_LOGISTICS } from "@/lib/constants/directed-logistics";
import { LOGISTICS_INTERVAL } from "@/lib/constants/tick-cadence";

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
});

// ── market band math (anchorMult:1, demandRate:1; GOODS.food priceFloor:0.5, priceCeiling:2.0)
// targetStock = 40×1×1 = 40; minStock = 40/2 = 20; maxStock = 40/0.5 + storageCapacity = 80+storageCapacity.
// mA: stock=95, storageCapacity=20 → targetStock=40; surplusThreshold=40×1.4=56; 95≥56 ✓ surplus; drawable=95−40=55.
// mB: stock=10, storageCapacity=20 → targetStock=40; deficitThreshold=40×0.8=32; 10<32 ✓ deficit; shortfall=40−10=30.
// tick=0 (monthly pulse boundary): pulseShard(1, 0, 24) → start=0, end=1 (all factions redistribute).
// engine quantity=min(shortfall 30, drawable 55, affordable 200)=30. A logistics delivery is a level-fill
// toward the anchor, so the body moves exactly that (no catch-up): moved=min(30, 95−20, 100−10)=30 → mB lands at 40 (=anchor).
function market(id: string, goodId: string, stock: number, storageCapacity: number) {
  return {
    id, goodId, stock,
    anchorMult: 1, demandRate: 1, storageCapacity,
  };
}

const DUE_TICK = 0; // monthly pulse: all factions redistribute on ticks where tick % interval === 0

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
      { interval: LOGISTICS_INTERVAL, routeCost: () => 1 },
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
      { interval: LOGISTICS_INTERVAL, routeCost: () => 1 },
    );
    // routeCost is a flat 1/unit, so the planned cost equals the moved quantity.
    expect(result.workPerformedByFaction!.get("f1")).toBeCloseTo(world.flows[0].quantity, 6);
  });

  it("fills a deficit toward its anchor in one delivery — never overshoots into surplus", async () => {
    // Regression for the catch-up overshoot: a single delivery is a level-fill toward the
    // days-of-supply anchor (targetStock), NOT a rate that scales with the shard interval.
    // mB: stock 10, anchor 40 → must land at the anchor (40), not be doubled into surplus (≥56).
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
      { interval: LOGISTICS_INTERVAL, routeCost: () => 1 },
    );
    const targetStock = 40; // 40 × demandRate 1 × anchorMult 1
    const surplusThreshold = targetStock * DIRECTED_LOGISTICS.SURPLUS_MARGIN; // 56
    const mBStock = world.stockUpdates.get("mB")!;
    expect(mBStock).toBeGreaterThan(10); // something was delivered
    expect(mBStock).toBeLessThanOrEqual(targetStock); // filled to the anchor, no further
    expect(mBStock).toBeLessThan(surplusThreshold); // and not flipped into a surplus donor
    // conservation: donor lost exactly what the recipient gained
    expect(world.stockUpdates.get("mA")!).toBeCloseTo(95 - (mBStock - 10), 6);
  });

  it("applies a fractional transfer without quantizing (scale-invariance guard)", async () => {
    // The engine matcher works in continuous goods units; the processor must apply the
    // transfer as-is. A fractional deficit stock (10.3) makes the shortfall fractional
    // (40 − 10.3 = 29.7); flooring here would drop it to 29. That lost unit is ~2% at
    // these magnitudes but a large fraction at ECONOMY_SCALE=1 and negligible at 100 —
    // the exact scale-variance this guards. Budget (population-scaled) and drawable (55)
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
      { interval: LOGISTICS_INTERVAL, routeCost: () => 1 },
    );
    expect(world.flows[0].quantity).toBeCloseTo(29.7, 6); // the fraction survives — NOT 29
    expect(world.stockUpdates.get("mB")!).toBeCloseTo(40, 6); // filled exactly to the anchor
    // conservation: donor lost exactly the fractional amount the recipient gained
    expect(world.stockUpdates.get("mA")!).toBeCloseTo(95 - 29.7, 6);
  });

  it("does nothing for an empty world", async () => {
    // empty world → getFactionShardKeys() returns [] → factionKeys.length === 0 → early return (before shardRange)
    const world = new MemoryDirectedLogisticsWorld([]);
    await runDirectedLogisticsProcessor(
      world,
      { tick: 7 },
      { interval: LOGISTICS_INTERVAL, routeCost: () => 1 },
    );
    expect(world.flows).toHaveLength(0);
  });

  it("moves nothing on an off-boundary tick (monthly pulse)", async () => {
    // Same surplus(mA)+deficit(mB) as the happy path, but tick=1: pulseShard(1, 1, 24) is an
    // empty window off the month boundary, so NO faction redistributes — distinct from the
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
      { interval: LOGISTICS_INTERVAL, routeCost: () => 1 },
    );
    expect(world.flows).toHaveLength(0);
    expect(world.stockUpdates.size).toBe(0);
  });

  // A market with a big demandRate → big targetStock, so the deficit's shortfall and the donor's
  // drawable both dwarf the per-pulse work budget: the budget is the binding constraint.
  function bigMarket(id: string, goodId: string, stock: number, demandRate: number) {
    return { id, goodId, stock, anchorMult: 1, demandRate, storageCapacity: 0 };
  }

  it("haul budget scales with the interval; deliveries stay gap-fills", async () => {
    // Budget-bound: huge deficit + huge drawable, so the per-pulse work budget (Σ pop × generation)
    // binds — moved = budget ÷ route cost. Halving the interval halves the budget, so it moves half
    // as much per pulse (same wall-clock haul capacity when run twice as often).
    const budgetBound = () => [
      { systemId: "A", factionId: "f1", population: 200, buildings: {}, yields: emptyResourceVector(), markets: [bigMarket("mA", "food", 100000, 1000)] },
      { systemId: "B", factionId: "f1", population: 200, buildings: {}, yields: emptyResourceVector(), markets: [bigMarket("mB", "food", 10, 1000)] },
    ];
    const movedAt = async (interval: number): Promise<number> => {
      const world = new MemoryDirectedLogisticsWorld(budgetBound());
      await runDirectedLogisticsProcessor(world, { tick: 0 }, { interval, routeCost: () => 1 });
      return world.flows[0].quantity;
    };
    const moved24 = await movedAt(24);
    const moved12 = await movedAt(12);
    expect(moved24).toBeGreaterThan(0);
    expect(moved12).toBeCloseTo(moved24 / 2, 6); // budget scaled with the interval

    // Gap-bound: a small deficit (shortfall 30) with an ample budget fills exactly the gap — a
    // level-fill toward the anchor, interval-invariant, NOT a scaled multiple.
    const gapFill = async (interval: number): Promise<number> => {
      const systems = [
        { systemId: "A", factionId: "f1", population: 200, buildings: {}, yields: emptyResourceVector(), markets: [market("mA", "food", 95, 20)] },
        { systemId: "B", factionId: "f1", population: 200, buildings: {}, yields: emptyResourceVector(), markets: [market("mB", "food", 10, 20)] },
      ];
      const world = new MemoryDirectedLogisticsWorld(systems);
      await runDirectedLogisticsProcessor(world, { tick: 0 }, { interval, routeCost: () => 1 });
      return world.flows[0].quantity;
    };
    expect(await gapFill(24)).toBeCloseTo(30, 6);
    expect(await gapFill(12)).toBeCloseTo(30, 6); // identical at half the interval — gap-fills don't scale
  });
});
