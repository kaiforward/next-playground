import { describe, it, expect } from "vitest";
import { InMemoryEconomyWorld } from "@/lib/tick/adapters/memory/economy";
import { buildingProduction, computeLabourState } from "@/lib/engine/industry";
import { makeResourceVector, unitResourceVector, emptyResourceVector } from "@/lib/engine/resources";
import type { TickSystem, TickMarket } from "@/lib/tick/rows";

function sys(overrides: Partial<TickSystem>): TickSystem {
  return {
    id: "s1", name: "S1", economyType: "extraction", regionId: "r1",
    factionId: "f1", control: "developed", governmentType: "frontier",
    population: 1000, popCap: 1200,
    unrest: 0, buildings: { ore: 5 }, buildingIdleMonths: {},
    yields: unitResourceVector(), slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0,
    ...overrides,
  };
}

const market = (goodId: string): TickMarket => ({
  systemId: "s1", goodId, basePrice: 35, stock: 100, anchorMult: 1,
  demandRate: 1, priceFloor: 0.5, priceCeiling: 2, storageCapacity: 0,
});

describe("InMemoryEconomyWorld — capacity-driven production", () => {
  it("derives baseProductionRate from buildings × outputPerUnit × labourFulfillment", async () => {
    const world = new InMemoryEconomyWorld(
      { systems: [sys({})], markets: [market("ore")], modifiers: [] },
    );
    const views = await world.getMarketsForSystems(["s1"]);
    const ore = views.find((v) => v.goodId === "ore")!;
    const state = computeLabourState({ ore: 5 }, 1000);
    expect(ore.baseProductionRate).toBeCloseTo(buildingProduction({ ore: 5 }, "ore", state, unitResourceVector()), 6);
  });

  it("produces nothing for a good with no buildings", async () => {
    const world = new InMemoryEconomyWorld(
      { systems: [sys({ buildings: {} })], markets: [market("ore")], modifiers: [] },
    );
    const views = await world.getMarketsForSystems(["s1"]);
    expect(views[0].baseProductionRate).toBeUndefined();
  });

  it("returns only markets for the requested systems", async () => {
    const world = new InMemoryEconomyWorld({
      systems: [sys({ id: "s1" }), sys({ id: "s2" })],
      markets: [
        { ...market("ore"), systemId: "s1" },
        { ...market("ore"), systemId: "s2" },
      ],
      modifiers: [],
    });
    const views = await world.getMarketsForSystems(["s1"]);
    expect(views.map((v) => v.systemId)).toEqual(["s1"]);
  });

  it("throttles output when population cannot staff the buildings", async () => {
    const staffed = new InMemoryEconomyWorld(
      { systems: [sys({ population: 100000 })], markets: [market("ore")], modifiers: [] },
    );
    const starved = new InMemoryEconomyWorld(
      { systems: [sys({ population: 1 })], markets: [market("ore")], modifiers: [] },
    );
    const a = (await staffed.getMarketsForSystems(["s1"]))[0].baseProductionRate ?? 0;
    const b = (await starved.getMarketsForSystems(["s1"]))[0].baseProductionRate ?? 0;
    expect(a).toBeGreaterThan(b);
  });

  it("scales tier-0 output by the system's per-resource yield multiplier", async () => {
    // Two otherwise-identical systems; only the ore yield differs (k=3 vs unit).
    const unitYield = new InMemoryEconomyWorld(
      { systems: [sys({ yields: unitResourceVector() })], markets: [market("ore")], modifiers: [] },
    );
    const richYield = new InMemoryEconomyWorld(
      { systems: [sys({ yields: makeResourceVector({ ore: 3 }) })], markets: [market("ore")], modifiers: [] },
    );
    const baseline = (await unitYield.getMarketsForSystems(["s1"]))[0].baseProductionRate ?? 0;
    const rich = (await richYield.getMarketsForSystems(["s1"]))[0].baseProductionRate ?? 0;
    expect(baseline).toBeGreaterThan(0);
    expect(rich).toBeCloseTo(baseline * 3, 6);
  });

  it("does not scale tier-1 output by tier-0 yields (yield term is tier-0 only)", async () => {
    // 'metals' is a tier-1 good; its production must be invariant to the ore yield.
    // vocational_school licenses metals' skill1 demand (5×7=35 ≪ 150) so it isn't skill-gated.
    const metalsSys = (yields: ReturnType<typeof unitResourceVector>): TickSystem =>
      sys({ economyType: "industrial", buildings: { metals: 5, vocational_school: 1 }, yields });
    const unitYield = new InMemoryEconomyWorld(
      { systems: [metalsSys(unitResourceVector())], markets: [market("metals")], modifiers: [] },
    );
    const richYield = new InMemoryEconomyWorld(
      { systems: [metalsSys(makeResourceVector({ ore: 3 }))], markets: [market("metals")], modifiers: [] },
    );
    const baseline = (await unitYield.getMarketsForSystems(["s1"]))[0].baseProductionRate ?? 0;
    const rich = (await richYield.getMarketsForSystems(["s1"]))[0].baseProductionRate ?? 0;
    expect(baseline).toBeGreaterThan(0);
    expect(rich).toBeCloseTo(baseline, 6);
  });
});
