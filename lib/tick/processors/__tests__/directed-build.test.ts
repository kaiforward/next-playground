import { describe, it, expect } from "vitest";
import { runDirectedBuildProcessor } from "@/lib/tick/processors/directed-build";
import { MemoryDirectedBuildWorld } from "@/lib/tick/adapters/memory/directed-build";
import type { SystemBuildRow } from "@/lib/tick/world/directed-build-world";
import type { MarketRowForLogistics } from "@/lib/tick/world/directed-logistics-world";
import { emptyResourceVector, unitResourceVector, RESOURCE_TYPES } from "@/lib/engine/resources";
import type { RouteCost } from "@/lib/engine/directed-logistics";

const reachable: RouteCost = () => 1;

// food market with a high demandRate so the band's targetStock is large — stock 1 is a deep deficit.
function foodMarket(systemId: string, stock: number): MarketRowForLogistics {
  return {
    id: `${systemId}|food`, goodId: "food", stock, basePrice: 10, anchorMult: 1,
    demandRate: 1000, priceFloor: 0.5, priceCeiling: 3.0, storageCapacity: 0,
  };
}

const INTERVAL = 4;
const DUE_TICK = INTERVAL - 1; // a single faction shard is due when tick % interval === interval-1
const NOT_DUE_TICK = 0;        // window [floor(0), floor(1/4)) = [0,0) — empty

function builderSlots(n: number) {
  const slotCap = emptyResourceVector();
  for (const k of RESOURCE_TYPES) slotCap[k] = n;
  return slotCap;
}

// A: deep structural food deficit, no capacity. B: builder with arable slots + budget, reachable from A.
function scenario(bFood: number, bHousing: number): SystemBuildRow[] {
  return [
    {
      systemId: "A", factionId: "f1", population: 100, buildings: {},
      yields: unitResourceVector(), slotCap: emptyResourceVector(),
      generalSpace: 0, habitableSpace: 0, markets: [foodMarket("A", 1)],
    },
    {
      systemId: "B", factionId: "f1", population: 5000, buildings: { food: bFood, housing: bHousing },
      yields: unitResourceVector(), slotCap: builderSlots(20),
      generalSpace: 100, habitableSpace: 100, markets: [],
    },
  ];
}

function countOf(w: MemoryDirectedBuildWorld, systemId: string, type: string): number {
  const u = w.buildingUpdates.find((x) => x.systemId === systemId && x.buildingType === type);
  return u?.count ?? 0;
}

describe("runDirectedBuildProcessor", () => {
  it("builds production + housing at a reachable builder on a due tick", async () => {
    const w = new MemoryDirectedBuildWorld(scenario(0, 0));
    await runDirectedBuildProcessor(w, { tick: DUE_TICK }, { interval: INTERVAL, routeCost: reachable });
    expect(countOf(w, "B", "food")).toBeGreaterThan(0);
    expect(countOf(w, "B", "housing")).toBeGreaterThan(0);
    // Writes are absolute new counts (current 0 + added), never the deficit system A.
    expect(w.buildingUpdates.every((u) => u.systemId === "B")).toBe(true);
  });

  it("does nothing on a not-due tick (empty shard window)", async () => {
    const w = new MemoryDirectedBuildWorld(scenario(0, 0));
    await runDirectedBuildProcessor(w, { tick: NOT_DUE_TICK }, { interval: INTERVAL, routeCost: reachable });
    expect(w.buildingUpdates).toHaveLength(0);
  });

  it("develops a hand-seeded world: keeps building toward the unmet deficit across cycles", async () => {
    // Cycle 1 from a blank builder; feed its output counts back as cycle-2 input so increments persist.
    const w1 = new MemoryDirectedBuildWorld(scenario(0, 0));
    await runDirectedBuildProcessor(w1, { tick: DUE_TICK }, { interval: INTERVAL, routeCost: reachable });
    const food1 = countOf(w1, "B", "food");
    expect(food1).toBeGreaterThan(0);

    const w2 = new MemoryDirectedBuildWorld(scenario(food1, countOf(w1, "B", "housing")));
    await runDirectedBuildProcessor(w2, { tick: DUE_TICK }, { interval: INTERVAL, routeCost: reachable });
    expect(countOf(w2, "B", "food")).toBeGreaterThan(food1);
  });

  it("returns no writes when there are no structural deficits", async () => {
    const balanced: SystemBuildRow[] = [{
      systemId: "A", factionId: "f1", population: 100, buildings: {},
      yields: unitResourceVector(), slotCap: builderSlots(10), generalSpace: 50, habitableSpace: 50,
      markets: [{ ...foodMarket("A", 1), demandRate: 0 }], // demandRate 0 → targetStock 0 → balanced
    }];
    const w = new MemoryDirectedBuildWorld(balanced);
    await runDirectedBuildProcessor(w, { tick: DUE_TICK }, { interval: INTERVAL, routeCost: reachable });
    expect(w.buildingUpdates).toHaveLength(0);
  });
});
