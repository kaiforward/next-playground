import { describe, it, expect } from "vitest";
import { runMigrationProcessor } from "../migration";
import { InMemoryMigrationWorld } from "@/lib/tick/adapters/memory/migration";
import type { TickContext } from "@/lib/tick/types";
import type { SimConnection, SimSystem } from "@/lib/engine/simulator/types";

const PARAMS = {
  edgesPerTick: 100,
  flow: { weights: { contentment: 1, headroom: 1 }, maxOutflowFraction: 0.1, gradientThreshold: 0.01, distanceDecay: 0.1 },
};

function sys(id: string, factionId: string | null, population: number, popCap: number, unrest: number): SimSystem {
  return {
    id, name: id, economyType: "extraction", regionId: "r1", factionId, governmentType: "federation",
    aggregate: { gas: 0, minerals: 0, ore: 0, biomass: 0, arable: 0, water: 0, radioactive: 0 },
    population, popCap, unrest, traits: [], bodyDanger: 0,
  };
}
const conn = (a: string, b: string, fuelCost = 10): SimConnection => ({ fromSystemId: a, toSystemId: b, fuelCost });
const ctx = (tick: number): TickContext => ({ tx: undefined as never, tick, results: new Map() });

describe("migration processor", () => {
  it("relocates population from a tense full system to a calm roomy neighbour, conserved", async () => {
    const systems = [sys("a", "f1", 1000, 1000, 0.9), sys("b", "f1", 100, 1000, 0)];
    const world = new InMemoryMigrationWorld({ systems }, [conn("a", "b")]);
    const before = world.systems.reduce((s, x) => s + x.population, 0);
    await runMigrationProcessor(world, ctx(0), PARAMS);
    expect(world.systems.find((s) => s.id === "a")!.population).toBeLessThan(1000);
    expect(world.systems.find((s) => s.id === "b")!.population).toBeGreaterThan(100);
    expect(world.systems.reduce((s, x) => s + x.population, 0)).toBeCloseTo(before, 5);
  });
  it("does not migrate across a faction border", async () => {
    const systems = [sys("a", "f1", 1000, 1000, 0.9), sys("b", "f2", 100, 1000, 0)];
    const world = new InMemoryMigrationWorld({ systems }, [conn("a", "b")]);
    await runMigrationProcessor(world, ctx(0), PARAMS);
    expect(world.systems.find((s) => s.id === "a")!.population).toBe(1000);
  });
});
