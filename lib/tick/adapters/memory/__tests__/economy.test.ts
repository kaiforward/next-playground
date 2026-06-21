import { describe, it, expect } from "vitest";
import { InMemoryEconomyWorld } from "@/lib/tick/adapters/memory/economy";
import { buildingProduction, labourFulfillment, labourDemand } from "@/lib/engine/industry";
import { makeResourceVector, unitResourceVector } from "@/lib/engine/resources";
import type { SimSystem, SimMarketEntry, SimRegion } from "@/lib/engine/simulator/types";

function sys(overrides: Partial<SimSystem>): SimSystem {
  return {
    id: "s1", name: "S1", economyType: "extraction", regionId: "r1",
    factionId: "f1", governmentType: "frontier",
    population: 1000, popCap: 1200,
    traits: [], bodyDanger: 0, unrest: 0, buildings: { ore: 5 },
    yields: unitResourceVector(),
    ...overrides,
  };
}

const region: SimRegion = { id: "r1", name: "R1" };
const market = (goodId: string): SimMarketEntry => ({
  systemId: "s1", goodId, basePrice: 35, stock: 100, anchorMult: 1,
  demandRate: 1, priceFloor: 0.5, priceCeiling: 2, storageCapacity: 0,
});

describe("InMemoryEconomyWorld — capacity-driven production", () => {
  it("derives baseProductionRate from buildings × outputPerUnit × labourFulfillment", async () => {
    const world = new InMemoryEconomyWorld(
      { systems: [sys({})], markets: [market("ore")], modifiers: [] },
      [region],
    );
    const views = await world.getMarketsForRegion("r1");
    const ore = views.find((v) => v.goodId === "ore")!;
    const fulfillment = labourFulfillment(1000, labourDemand({ ore: 5 }));
    expect(ore.baseProductionRate).toBeCloseTo(buildingProduction({ ore: 5 }, "ore", fulfillment, unitResourceVector()), 6);
  });

  it("produces nothing for a good with no buildings", async () => {
    const world = new InMemoryEconomyWorld(
      { systems: [sys({ buildings: {} })], markets: [market("ore")], modifiers: [] },
      [region],
    );
    const views = await world.getMarketsForRegion("r1");
    expect(views[0].baseProductionRate).toBeUndefined();
  });

  it("throttles output when population cannot staff the buildings", async () => {
    const staffed = new InMemoryEconomyWorld(
      { systems: [sys({ population: 100000 })], markets: [market("ore")], modifiers: [] }, [region],
    );
    const starved = new InMemoryEconomyWorld(
      { systems: [sys({ population: 1 })], markets: [market("ore")], modifiers: [] }, [region],
    );
    const a = (await staffed.getMarketsForRegion("r1"))[0].baseProductionRate ?? 0;
    const b = (await starved.getMarketsForRegion("r1"))[0].baseProductionRate ?? 0;
    expect(a).toBeGreaterThan(b);
  });

  it("scales tier-0 output by the system's per-resource yield multiplier", async () => {
    // Two otherwise-identical systems; only the ore yield differs (k=3 vs unit).
    const unitYield = new InMemoryEconomyWorld(
      { systems: [sys({ yields: unitResourceVector() })], markets: [market("ore")], modifiers: [] },
      [region],
    );
    const richYield = new InMemoryEconomyWorld(
      { systems: [sys({ yields: makeResourceVector({ ore: 3 }) })], markets: [market("ore")], modifiers: [] },
      [region],
    );
    const baseline = (await unitYield.getMarketsForRegion("r1"))[0].baseProductionRate ?? 0;
    const rich = (await richYield.getMarketsForRegion("r1"))[0].baseProductionRate ?? 0;
    expect(baseline).toBeGreaterThan(0);
    expect(rich).toBeCloseTo(baseline * 3, 6);
  });

  it("does not scale tier-1 output by tier-0 yields (yield term is tier-0 only)", async () => {
    // 'metals' is a tier-1 good; its production must be invariant to the ore yield.
    const metalsSys = (yields: ReturnType<typeof unitResourceVector>): SimSystem =>
      sys({ economyType: "industrial", buildings: { metals: 5 }, yields });
    const unitYield = new InMemoryEconomyWorld(
      { systems: [metalsSys(unitResourceVector())], markets: [market("metals")], modifiers: [] },
      [region],
    );
    const richYield = new InMemoryEconomyWorld(
      { systems: [metalsSys(makeResourceVector({ ore: 3 }))], markets: [market("metals")], modifiers: [] },
      [region],
    );
    const baseline = (await unitYield.getMarketsForRegion("r1"))[0].baseProductionRate ?? 0;
    const rich = (await richYield.getMarketsForRegion("r1"))[0].baseProductionRate ?? 0;
    expect(baseline).toBeGreaterThan(0);
    expect(rich).toBeCloseTo(baseline, 6);
  });
});
