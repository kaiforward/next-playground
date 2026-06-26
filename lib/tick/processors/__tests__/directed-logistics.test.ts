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
// mA: stock=95, storageCapacity=20 → maxStock=100; surplusThreshold=0.9×100=90; 95≥90 ✓ surplus; drawable=95−20=75.
// mB: stock=10, storageCapacity=20 → maxStock=100; minStock=20; 10<20 ✓ deficit; shortfall=10.
// tick=INTERVAL−1 (=47): shardRange(1, 47, 48) → start=0, end=1; catchUp=48/24=2.
// engine quantity=min(10,75,100)=10; body qty=floor(10×2)=20; moved=min(20,75,90)=20 > 0 ✓.
function market(id: string, goodId: string, stock: number, storageCapacity: number) {
  return {
    id, goodId, stock,
    basePrice: 30, anchorMult: 1, demandRate: 1, priceFloor: 0.5, priceCeiling: 2.0, storageCapacity,
  };
}

const DUE_TICK = DIRECTED_LOGISTICS.INTERVAL - 1; // 47 — last slot, shard window [0,1) covers the 1 faction key

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
    const world = new MemoryDirectedLogisticsWorld(systems, new Map([["food", "good-food"]]));
    await runDirectedLogisticsProcessor(
      world,
      { tick: DUE_TICK } as { tick: number; tx: never; results: never },
      { interval: DIRECTED_LOGISTICS.INTERVAL, routeCost: () => 1 },
    );
    expect(world.flows).toHaveLength(1);
    expect(world.flows[0]).toMatchObject({ fromSystemId: "A", toSystemId: "B", goodId: "good-food" });
    expect(world.flows[0].quantity).toBeGreaterThan(0);
    // both market stocks were written (source down, dest up)
    expect(world.stockUpdates.has("mA")).toBe(true);
    expect(world.stockUpdates.has("mB")).toBe(true);
  });

  it("does nothing when no faction shard is due this tick", async () => {
    // tick=7, interval=48: shardRange(0, 7, 48) → empty factionKeys list → returns {}
    const world = new MemoryDirectedLogisticsWorld([], new Map());
    await runDirectedLogisticsProcessor(
      world,
      { tick: 7 } as { tick: number; tx: never; results: never },
      { interval: DIRECTED_LOGISTICS.INTERVAL, routeCost: () => 1 },
    );
    expect(world.flows).toHaveLength(0);
  });
});
