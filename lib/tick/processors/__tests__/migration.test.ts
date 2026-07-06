import { describe, it, expect } from "vitest";
import { runMigrationProcessor } from "../migration";
import { InMemoryMigrationWorld } from "@/lib/tick/adapters/memory/migration";
import { REFERENCE_INTERVAL } from "@/lib/constants/tick-cadence";
import type { TickContext } from "@/lib/tick/types";
import type { SimConnection, SimSystem } from "@/lib/engine/simulator/types";
import { unitResourceVector, emptyResourceVector } from "@/lib/engine/resources";

const PARAMS = {
  interval: REFERENCE_INTERVAL, // catch-up factor 1 → calibrated per-edge magnitudes
  flow: { weights: { contentment: 1, headroom: 1 }, maxOutflowFraction: 0.1, gradientThreshold: 0.01, distanceDecay: 0.1 },
};

// A single-edge world has its lone edge in the LAST shard group at the reference interval.
const EDGE_TICK = REFERENCE_INTERVAL - 1;

function sys(id: string, factionId: string | null, population: number, popCap: number, unrest: number): SimSystem {
  return {
    id, name: id, economyType: "extraction", regionId: "r1", factionId, governmentType: "federation",
    population, popCap, unrest, traits: [], buildings: {},
    yields: unitResourceVector(), slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0,
  };
}
const conn = (a: string, b: string, fuelCost = 10): SimConnection => ({ fromSystemId: a, toSystemId: b, fuelCost });
const ctx = (tick: number): TickContext => ({ tx: undefined as never, tick, results: new Map() });

describe("migration processor", () => {
  it("relocates population from a tense full system to a calm roomy neighbour, conserved", async () => {
    const systems = [sys("a", "f1", 1000, 1000, 0.9), sys("b", "f1", 100, 1000, 0)];
    const world = new InMemoryMigrationWorld({ systems }, [conn("a", "b")]);
    const before = world.systems.reduce((s, x) => s + x.population, 0);
    await runMigrationProcessor(world, ctx(EDGE_TICK), PARAMS);
    expect(world.systems.find((s) => s.id === "a")!.population).toBeLessThan(1000);
    expect(world.systems.find((s) => s.id === "b")!.population).toBeGreaterThan(100);
    expect(world.systems.reduce((s, x) => s + x.population, 0)).toBeCloseTo(before, 5);
  });
  it("does not migrate across a faction border", async () => {
    const systems = [sys("a", "f1", 1000, 1000, 0.9), sys("b", "f2", 100, 1000, 0)];
    const world = new InMemoryMigrationWorld({ systems }, [conn("a", "b")]);
    await runMigrationProcessor(world, ctx(EDGE_TICK), PARAMS);
    expect(world.systems.find((s) => s.id === "a")!.population).toBe(1000);
  });
  it("drains a CALM overshot system (population > popCap, unrest 0) to a roomy neighbour, conserved", async () => {
    // Overshoot with zero unrest: the death sink would do nothing here; migration must.
    const systems = [sys("a", "f1", 1500, 1000, 0), sys("b", "f1", 100, 1000, 0)];
    const world = new InMemoryMigrationWorld({ systems }, [conn("a", "b")]);
    const before = world.systems.reduce((s, x) => s + x.population, 0);
    await runMigrationProcessor(world, ctx(EDGE_TICK), PARAMS);
    expect(world.systems.find((s) => s.id === "a")!.population).toBeLessThan(1500);
    expect(world.systems.find((s) => s.id === "b")!.population).toBeGreaterThan(100);
    expect(world.systems.reduce((s, x) => s + x.population, 0)).toBeCloseTo(before, 5);
  });
  it("scales the migrated amount by catchUpFactor(interval)", async () => {
    // Same single edge processed at interval = REFERENCE (catch-up 1) vs 2×REFERENCE
    // (catch-up 2). Migration conserves, so the moved amount simply doubles.
    const mk = () =>
      new InMemoryMigrationWorld(
        { systems: [sys("a", "f1", 1000, 1000, 0.9), sys("b", "f1", 100, 1000, 0)] },
        [conn("a", "b")],
      );
    const w1 = mk();
    await runMigrationProcessor(w1, ctx(REFERENCE_INTERVAL - 1), { ...PARAMS, interval: REFERENCE_INTERVAL });
    const moved1 = 1000 - w1.systems.find((s) => s.id === "a")!.population;

    const w2 = mk();
    await runMigrationProcessor(w2, ctx(2 * REFERENCE_INTERVAL - 1), { ...PARAMS, interval: 2 * REFERENCE_INTERVAL });
    const moved2 = 1000 - w2.systems.find((s) => s.id === "a")!.population;

    expect(moved1).toBeGreaterThan(0);
    expect(moved2).toBeCloseTo(2 * moved1, 5);
  });
});
