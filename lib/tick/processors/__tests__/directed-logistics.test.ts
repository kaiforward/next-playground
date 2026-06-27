import { describe, it, expect } from "vitest";
import { MemoryDirectedLogisticsWorld } from "@/lib/tick/adapters/memory/directed-logistics";
import { emptyResourceVector } from "@/lib/engine/resources";
import { runDirectedLogisticsProcessor } from "@/lib/tick/processors/directed-logistics";
import { DIRECTED_LOGISTICS } from "@/lib/constants/directed-logistics";

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

// ── market band math (anchorMult:1, demandRate:1, priceFloor:0.5, priceCeiling:2.0)
// targetStock = 40×1×1 = 40; minStock = 40/2 = 20; maxStock = 40/0.5 + storageCapacity = 80+storageCapacity.
// mA: stock=95, storageCapacity=20 → targetStock=40; surplusThreshold=40×1.4=56; 95≥56 ✓ surplus; drawable=95−20=75.
// mB: stock=10, storageCapacity=20 → minStock=20; 10<20 ✓ deficit; shortfall=10.
// tick=INTERVAL−1 (=47): shardRange(1, 47, 48) → start=0, end=1; catchUp=48/24=2.
// engine quantity=min(10,75,100)=10; body qty=floor(10×2)=20; moved=min(20,75,90)=20 > 0 ✓.
function market(id: string, goodId: string, stock: number, storageCapacity: number) {
  return {
    id, goodId, stock,
    basePrice: 30, anchorMult: 1, demandRate: 1, priceFloor: 0.5, priceCeiling: 2.0, storageCapacity,
  };
}

const DUE_TICK = DIRECTED_LOGISTICS.INTERVAL - 1; // 47 — last slot, shard window [0,1) covers the 1 faction key

describe("MemoryDirectedLogisticsWorld — Contract I/O", () => {
  it("captures created + closed Contracts and returns seeded expired ones", async () => {
    const expired = [
      { id: "c1", fromSystemId: "A", toSystemId: "B", goodId: "food", quantity: 12 },
    ];
    const world = new MemoryDirectedLogisticsWorld([], expired);

    expect(await world.takeExpiredLogisticsContracts(99, ["f1"])).toEqual(expired);

    await world.createLogisticsContracts([
      { fromSystemId: "A", toSystemId: "B", goodId: "food", quantity: 8,
        reward: 50, deadlineTick: 100, factionId: "f1", createdAtTick: 52 },
    ]);
    await world.closeLogisticsContracts(["c1"]);

    expect(world.createdContracts).toHaveLength(1);
    expect(world.createdContracts[0]).toMatchObject({ fromSystemId: "A", toSystemId: "B" });
    expect(world.closedContractIds).toEqual(["c1"]);
  });
});

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
      { interval: DIRECTED_LOGISTICS.INTERVAL, routeCost: () => 1, contractCount: 0, contractTerms: () => null },
    );
    expect(world.flows).toHaveLength(1);
    expect(world.flows[0]).toMatchObject({ fromSystemId: "A", toSystemId: "B", goodId: "food" });
    expect(world.flows[0].quantity).toBeGreaterThan(0);
    // both market stocks were written (source down, dest up)
    expect(world.stockUpdates.has("mA")).toBe(true);
    expect(world.stockUpdates.has("mB")).toBe(true);
  });

  it("does nothing for an empty world", async () => {
    // empty world → getFactionShardKeys() returns [] → factionKeys.length === 0 → early return (before shardRange)
    const world = new MemoryDirectedLogisticsWorld([]);
    await runDirectedLogisticsProcessor(
      world,
      { tick: 7 },
      { interval: DIRECTED_LOGISTICS.INTERVAL, routeCost: () => 1, contractCount: 0, contractTerms: () => null },
    );
    expect(world.flows).toHaveLength(0);
  });

  it("skips a faction that has work but whose shard is not due this tick", async () => {
    // Same surplus(mA)+deficit(mB) as the happy path, but tick=0: shardRange(1, 0, 48) is an
    // empty window, so f1 is not due and NO work runs — distinct from the empty-world early return.
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
      { tick: 0 },
      { interval: DIRECTED_LOGISTICS.INTERVAL, routeCost: () => 1, contractCount: 0, contractTerms: () => null },
    );
    expect(world.flows).toHaveLength(0);
    expect(world.stockUpdates.size).toBe(0);
  });
});

describe("runDirectedLogisticsProcessor — Contracts", () => {
  const noTerms = () => null;

  it("diverts the matched transfer into a Contract instead of a silent move", async () => {
    const systems = [
      { systemId: "A", factionId: "f1", population: 200, buildings: {},
        yields: emptyResourceVector(), markets: [market("mA", "food", 95, 20)] },
      { systemId: "B", factionId: "f1", population: 200, buildings: {},
        yields: emptyResourceVector(), markets: [market("mB", "food", 10, 20)] },
    ];
    const world = new MemoryDirectedLogisticsWorld(systems);
    await runDirectedLogisticsProcessor(world, { tick: DUE_TICK }, {
      interval: DIRECTED_LOGISTICS.INTERVAL,
      routeCost: () => 1,
      contractCount: 1,
      contractTerms: ({ quantity }) => ({ reward: quantity * 2, deadlineTick: DUE_TICK + 48 }),
    });
    // The one transfer became a Contract: no silent flow, no stock move at creation.
    expect(world.createdContracts).toHaveLength(1);
    expect(world.createdContracts[0]).toMatchObject({ fromSystemId: "A", toSystemId: "B", goodId: "food" });
    expect(world.flows).toHaveLength(0);
    expect(world.stockUpdates.size).toBe(0);
  });

  it("hauls an expired unclaimed Contract itself (timeout-resolve), then closes it", async () => {
    const systems = [
      { systemId: "A", factionId: "f1", population: 200, buildings: {},
        yields: emptyResourceVector(), markets: [market("mA", "food", 95, 20)] },
      { systemId: "B", factionId: "f1", population: 200, buildings: {},
        yields: emptyResourceVector(), markets: [market("mB", "food", 10, 20)] },
    ];
    const expired = [{ id: "c1", fromSystemId: "A", toSystemId: "B", goodId: "food", quantity: 6 }];
    const world = new MemoryDirectedLogisticsWorld(systems, expired);
    await runDirectedLogisticsProcessor(world, { tick: DUE_TICK }, {
      interval: DIRECTED_LOGISTICS.INTERVAL,
      routeCost: () => 1,
      contractCount: 0,        // no new Contracts; isolate the resolve path
      contractTerms: noTerms,
    });
    expect(world.closedContractIds).toEqual(["c1"]);
    // The haul produced a logistics flow A→B and moved stock.
    const haul = world.flows.find((f) => f.fromSystemId === "A" && f.toSystemId === "B");
    expect(haul?.quantity).toBe(6);
    expect(world.stockUpdates.has("mA")).toBe(true);
    expect(world.stockUpdates.has("mB")).toBe(true);
  });

  it("contractCount 0 → no Contracts created (pure silent, the sim path)", async () => {
    const systems = [
      { systemId: "A", factionId: "f1", population: 200, buildings: {},
        yields: emptyResourceVector(), markets: [market("mA", "food", 95, 20)] },
      { systemId: "B", factionId: "f1", population: 200, buildings: {},
        yields: emptyResourceVector(), markets: [market("mB", "food", 10, 20)] },
    ];
    const world = new MemoryDirectedLogisticsWorld(systems);
    await runDirectedLogisticsProcessor(world, { tick: DUE_TICK }, {
      interval: DIRECTED_LOGISTICS.INTERVAL,
      routeCost: () => 1,
      contractCount: 0,
      contractTerms: noTerms,
    });
    expect(world.createdContracts).toHaveLength(0);
    expect(world.flows).toHaveLength(1); // still moved silently
  });
});
