import { describe, it, expect } from "vitest";
import { runPopulationProcessor } from "../population";
import { InMemoryPopulationWorld } from "@/lib/tick/adapters/memory/population";
import type { TickContext } from "@/lib/tick/types";
import type { SimMarketEntry, SimSystem } from "@/lib/engine/simulator/types";
import { demandRateForGood, totalDemandRateForGood } from "@/lib/constants/market-economy";
import { labourDemand, labourFulfillment } from "@/lib/engine/industry";
import { unitResourceVector } from "@/lib/engine/resources";

const PARAMS = { unrest: { gain: 0.1, decay: 0.05 }, population: { growthRate: 0.02, declineRate: 0.02 } };

function sys(id: string, population: number, popCap: number, unrest = 0, buildings: Record<string, number> = {}): SimSystem {
  return {
    id, name: id, economyType: "extraction", regionId: "r1", factionId: "f1", governmentType: "federation",
    population, popCap, unrest, traits: [], bodyDanger: 0, buildings,
    yields: unitResourceVector(),
  };
}
function market(systemId: string, goodId: string): SimMarketEntry {
  return { systemId, goodId, basePrice: 100, stock: 100, anchorMult: 1, demandRate: 1, priceFloor: 10, priceCeiling: 500 };
}
function ctxWithD(d: Map<string, number>): TickContext {
  return { tx: undefined as never, tick: 0, results: new Map([["economy", { economySignals: { dissatisfactionBySystem: d } }]]) };
}

describe("population processor", () => {
  it("grows a fed system and leaves unrest at 0", async () => {
    const world = new InMemoryPopulationWorld({ systems: [sys("a", 500, 1000, 0)], markets: [market("a", "food")] });
    await runPopulationProcessor(world, ctxWithD(new Map([["a", 0]])), PARAMS);
    const a = world.systems.find((s) => s.id === "a")!;
    expect(a.unrest).toBe(0);
    expect(a.population).toBeGreaterThan(500);
  });
  it("raises unrest and rewrites demandRate for a starved system", async () => {
    const world = new InMemoryPopulationWorld({ systems: [sys("a", 500, 1000, 0)], markets: [market("a", "food")] });
    await runPopulationProcessor(world, ctxWithD(new Map([["a", 1]])), PARAMS);
    const a = world.systems.find((s) => s.id === "a")!;
    // Hand-derived from the start state (pop 500, cap 1000, unrest 0) under D=1, so these
    // are an independent oracle rather than the processor's own output read back:
    //   unrest = 0 + gain·1 − decay·0 = 0.1
    //   Δpop   = growth·(1−D)=0 − decline·pop·unrest = −(0.02·500·0.1) = −1.0 → pop 499
    expect(a.unrest).toBeCloseTo(0.1, 6);
    expect(a.population).toBeCloseTo(499, 6);
    const m = world.markets.find((mm) => mm.systemId === "a")!;
    // demandRate = max(perCapitaNeed_food · pop, MIN_DEMAND) = max(0.004 · 499, 0.05)
    expect(m.demandRate).toBeCloseTo(Math.max(0.004 * 499, 0.05), 5);
  });
  it("includes production-input demand in the rewritten demandRate", async () => {
    // A smelter (metals building) draws ore as a recipe input. The ore market's
    // demandRate must be larger than the civilian-only floor once the input term is folded in.
    const population = 500;
    const buildings = { metals: 3, housing: 1 };
    const world = new InMemoryPopulationWorld({
      systems: [sys("s", population, 1000, 0, buildings)],
      markets: [
        market("s", "food"),
        market("s", "ore"),
      ],
    });
    await runPopulationProcessor(world, ctxWithD(new Map([["s", 0]])), PARAMS);

    const oreMarket = world.markets.find((m) => m.systemId === "s" && m.goodId === "ore")!;
    const afterPop = world.systems.find((s) => s.id === "s")!.population;
    const fulfillment = labourFulfillment(afterPop, labourDemand(buildings));

    // Ore has no per-capita need, so civilian-only gives MIN_DEMAND.
    const civilianOnly = demandRateForGood("ore", afterPop);
    const withIndustrial = totalDemandRateForGood("ore", afterPop, buildings, fulfillment, unitResourceVector());

    // The smelter's ore draw must push the rate above the civilian-only floor.
    expect(withIndustrial).toBeGreaterThan(civilianOnly);
    expect(oreMarket.demandRate).toBeCloseTo(withIndustrial, 6);
  });

  it("no-ops when the economy left no signals", async () => {
    const world = new InMemoryPopulationWorld({ systems: [sys("a", 500, 1000)], markets: [] });
    const before = world.systems[0].population;
    await runPopulationProcessor(world, { tx: undefined as never, tick: 0, results: new Map() }, PARAMS);
    expect(world.systems[0].population).toBe(before);
  });
  it("no-ops when the economy signal map is present but empty", async () => {
    const world = new InMemoryPopulationWorld({ systems: [sys("a", 500, 1000)], markets: [] });
    const before = world.systems[0].population;
    await runPopulationProcessor(world, ctxWithD(new Map()), PARAMS);
    expect(world.systems[0].population).toBe(before);
  });
});
