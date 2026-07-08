import { describe, it, expect } from "vitest";
import { runDirectedBuildProcessor } from "@/lib/tick/processors/directed-build";
import { MemoryDirectedBuildWorld } from "@/lib/tick/adapters/memory/directed-build";
import type { SystemBuildRow } from "@/lib/tick/world/directed-build-world";
import type { MarketRowForLogistics } from "@/lib/tick/world/directed-logistics-world";
import { emptyResourceVector, unitResourceVector, RESOURCE_TYPES } from "@/lib/engine/resources";
import type { RouteCost } from "@/lib/engine/directed-logistics";
import type { ClaimCandidate, DevelopCandidate, ExpansionParams, DevelopParams } from "@/lib/engine/expansion";
import { mulberry32 } from "@/lib/engine/universe-gen";

const reachable: RouteCost = () => 1;

// food market with a high demandRate so the band's targetStock is large — stock 1 is a deep deficit.
function foodMarket(systemId: string, stock: number): MarketRowForLogistics {
  return {
    id: `${systemId}|food`, goodId: "food", stock, basePrice: 10, anchorMult: 1,
    demandRate: 1000, priceFloor: 0.5, priceCeiling: 3.0, storageCapacity: 0,
  };
}

const INTERVAL = 4;
const DUE_TICK = 0;      // monthly pulse: every faction plans on ticks where tick % interval === 0
const NOT_DUE_TICK = 1;  // off-boundary tick: pulseShard window is empty, no faction is due

function builderSlots(n: number) {
  const slotCap = emptyResourceVector();
  for (const k of RESOURCE_TYPES) slotCap[k] = n;
  return slotCap;
}

// A: deep structural food deficit, no capacity. B: builder with arable slots + budget, reachable from A.
function scenario(bFood: number, bHousing: number, slots = 20): SystemBuildRow[] {
  return [
    {
      systemId: "A", factionId: "f1", control: "unclaimed", population: 100, unrest: 0, buildings: {},
      yields: unitResourceVector(), slotCap: emptyResourceVector(),
      generalSpace: 0, habitableSpace: 0, markets: [foodMarket("A", 1)],
    },
    {
      systemId: "B", factionId: "f1", control: "developed", population: 5000, unrest: 0,
      buildings: { food: bFood, housing: bHousing },
      yields: unitResourceVector(), slotCap: builderSlots(slots),
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

  it("builds nothing on an off-boundary tick (monthly pulse)", async () => {
    const w = new MemoryDirectedBuildWorld(scenario(0, 0));
    await runDirectedBuildProcessor(w, { tick: NOT_DUE_TICK }, { interval: INTERVAL, routeCost: reachable });
    expect(w.buildingUpdates).toHaveLength(0);
  });

  it("develops a hand-seeded world: keeps building toward the unmet deficit across cycles", async () => {
    // Builder cap (1000 slots) far exceeds one cycle's build budget, so it fills
    // gradually: cycle 2 must add more on top of cycle 1's count (not cap out in one).
    // Cycle 1 from a blank builder; feed its output counts back as cycle-2 input so increments persist.
    const w1 = new MemoryDirectedBuildWorld(scenario(0, 0, 1000));
    await runDirectedBuildProcessor(w1, { tick: DUE_TICK }, { interval: INTERVAL, routeCost: reachable });
    const food1 = countOf(w1, "B", "food");
    expect(food1).toBeGreaterThan(0);

    const w2 = new MemoryDirectedBuildWorld(scenario(food1, countOf(w1, "B", "housing"), 1000));
    await runDirectedBuildProcessor(w2, { tick: DUE_TICK }, { interval: INTERVAL, routeCost: reachable });
    expect(countOf(w2, "B", "food")).toBeGreaterThan(food1);
  });

  it("never builds past capacity (capacity-bounded output)", async () => {
    // The build budget is per-cycle and the planner already plans one cycle's worth,
    // so the capacity-bounded output must be written as-is — a builder with a 10-slot
    // arable cap and ample budget must end at ≤ 10 food, never more, on the pulse boundary.
    const rows: SystemBuildRow[] = [
      {
        systemId: "A", factionId: "f1", control: "unclaimed", population: 100, unrest: 0, buildings: {},
        yields: unitResourceVector(), slotCap: emptyResourceVector(),
        generalSpace: 0, habitableSpace: 0, markets: [foodMarket("A", 1)],
      },
      {
        systemId: "B", factionId: "f1", control: "developed", population: 5000, unrest: 0, buildings: {},
        yields: unitResourceVector(), slotCap: builderSlots(10),
        generalSpace: 0, habitableSpace: 0, markets: [],
      },
    ];
    const w = new MemoryDirectedBuildWorld(rows);
    await runDirectedBuildProcessor(w, { tick: 0 }, { interval: 24, routeCost: reachable });
    const food = countOf(w, "B", "food");
    expect(food).toBeGreaterThan(0);
    expect(food).toBeLessThanOrEqual(10);
  });

  it("returns no writes when there are no structural deficits", async () => {
    const balanced: SystemBuildRow[] = [{
      systemId: "A", factionId: "f1", control: "developed", population: 100, unrest: 0, buildings: {},
      yields: unitResourceVector(), slotCap: builderSlots(10), generalSpace: 0, habitableSpace: 0,
      markets: [{ ...foodMarket("A", 1), demandRate: 0 }], // demandRate 0 → balanced; no habitable land → no proactive housing → no writes
    }];
    const w = new MemoryDirectedBuildWorld(balanced);
    await runDirectedBuildProcessor(w, { tick: DUE_TICK }, { interval: INTERVAL, routeCost: reachable });
    expect(w.buildingUpdates).toHaveLength(0);
  });
});

const EXP_PARAMS: ExpansionParams = {
  maxClaimsPerPulse: 1, scoreFloor: 0.001, weights: { habitable: 1, diversity: 3, trait: 2, proximity: 0.5 },
};
const DEV_PARAMS: DevelopParams = {
  maxDevelopsPerPulse: 1, habitableFloor: 1, seedPop: 50, weights: { habitable: 1, diversity: 3, trait: 2, proximity: 0.5 },
};

// One developed owned system so the faction is in the shard, with no build needs.
function ownedOnly(factionId: string): SystemBuildRow {
  return {
    systemId: `${factionId}-home`, factionId, control: "developed", population: 100, unrest: 0,
    buildings: {}, yields: unitResourceVector(), slotCap: emptyResourceVector(),
    generalSpace: 0, habitableSpace: 0, markets: [],
  };
}

describe("runDirectedBuildProcessor: claim + develop phase", () => {
  it("claims the best in-reach candidate on a due tick", async () => {
    const w = new MemoryDirectedBuildWorld([ownedOnly("f1")]);
    const reachProvider = (f: string): ClaimCandidate[] =>
      f === "f1" ? [
        { systemId: "u-poor", minHops: 1, habitableSpace: 5, resourceDiversity: 0, traitQuality: 0 },
        { systemId: "u-rich", minHops: 1, habitableSpace: 200, resourceDiversity: 4, traitQuality: 0 },
      ] : [];
    await runDirectedBuildProcessor(w, { tick: DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable,
      claim: { reachProvider, rng: mulberry32(1), params: EXP_PARAMS },
    });
    expect(w.claims).toEqual([{ systemId: "u-rich", factionId: "f1" }]);
  });

  it("develops the best controlled candidate on a due tick", async () => {
    const w = new MemoryDirectedBuildWorld([ownedOnly("f1")]);
    const candidateProvider = (f: string): DevelopCandidate[] =>
      f === "f1" ? [{ systemId: "c1", habitableSpace: 100, resourceDiversity: 2, traitQuality: 0, sourceSystemId: "f1-home" }] : [];
    await runDirectedBuildProcessor(w, { tick: DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable,
      develop: { candidateProvider, params: DEV_PARAMS },
    });
    expect(w.developments).toEqual([{ systemId: "c1", sourceSystemId: "f1-home", seedPop: 50 }]);
  });

  it("claims/develops nothing off the pulse boundary", async () => {
    const w = new MemoryDirectedBuildWorld([ownedOnly("f1")]);
    await runDirectedBuildProcessor(w, { tick: NOT_DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable,
      claim: { reachProvider: () => [{ systemId: "u1", minHops: 1, habitableSpace: 100, resourceDiversity: 3, traitQuality: 0 }], rng: mulberry32(1), params: EXP_PARAMS },
    });
    expect(w.claims).toHaveLength(0);
  });

  it("claims/develops nothing when no claim/develop param is supplied (existing build path)", async () => {
    const w = new MemoryDirectedBuildWorld(scenario(0, 0));
    await runDirectedBuildProcessor(w, { tick: DUE_TICK }, { interval: INTERVAL, routeCost: reachable });
    expect(w.claims).toHaveLength(0);
    expect(w.developments).toHaveLength(0);
    expect(countOf(w, "B", "food")).toBeGreaterThan(0); // build phase still runs
  });
});
