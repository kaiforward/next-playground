import { describe, it, expect } from "vitest";
import { InMemoryEconomyWorld } from "@/lib/tick/adapters/memory/economy";
import { buildingProduction, labourFulfillment, labourDemand } from "@/lib/engine/industry";
import { makeResourceVector } from "@/lib/engine/resources";
import type { SimSystem, SimMarketEntry, SimRegion } from "@/lib/engine/simulator/types";

function sys(overrides: Partial<SimSystem>): SimSystem {
  return {
    id: "s1", name: "S1", economyType: "extraction", regionId: "r1",
    factionId: "f1", governmentType: "frontier",
    aggregate: makeResourceVector({ ore: 8 }), population: 1000, popCap: 1200,
    traits: [], bodyDanger: 0, unrest: 0, buildings: { ore: 5 },
    ...overrides,
  };
}

const region: SimRegion = { id: "r1", name: "R1" };
const market = (goodId: string): SimMarketEntry => ({
  systemId: "s1", goodId, basePrice: 35, stock: 100, anchorMult: 1,
  demandRate: 1, priceFloor: 0.5, priceCeiling: 2,
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
    expect(ore.baseProductionRate).toBeCloseTo(buildingProduction({ ore: 5 }, "ore", fulfillment), 6);
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
});
