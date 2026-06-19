import { describe, it, expect } from "vitest";
import { runPopulationProcessor } from "../population";
import { InMemoryPopulationWorld } from "@/lib/tick/adapters/memory/population";
import type { TickContext } from "@/lib/tick/types";
import type { SimMarketEntry, SimSystem } from "@/lib/engine/simulator/types";

const PARAMS = { unrest: { gain: 0.1, decay: 0.05 }, population: { growthRate: 0.02, declineRate: 0.02 } };

function sys(id: string, population: number, popCap: number, unrest = 0): SimSystem {
  return {
    id, name: id, economyType: "extraction", regionId: "r1", factionId: "f1", governmentType: "federation",
    aggregate: { gas: 0, minerals: 0, ore: 0, biomass: 0, arable: 0, water: 0, radioactive: 0 },
    population, popCap, unrest, traits: [], bodyDanger: 0,
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
