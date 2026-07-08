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

// Migration is now a monthly pulse: all edges process on ticks where tick % interval === 0.
const EDGE_TICK = 0;

function sys(id: string, factionId: string | null, population: number, popCap: number, unrest: number): SimSystem {
  return {
    id, name: id, economyType: "extraction", regionId: "r1", factionId,
    control: factionId ? "developed" : "unclaimed", governmentType: "federation",
    population, popCap, unrest, traits: [], buildings: {},
    yields: unitResourceVector(), slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0,
  };
}
const conn = (a: string, b: string, fuelCost = 10): SimConnection => ({ fromSystemId: a, toSystemId: b, fuelCost });
const ctx = (tick: number): TickContext => ({ tick, results: new Map() });

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
    // (catch-up 2). Migration conserves, so the moved amount simply doubles. Tick 0
    // is a boundary for any interval, so the whole edge set resolves in both runs.
    const mk = () =>
      new InMemoryMigrationWorld(
        { systems: [sys("a", "f1", 1000, 1000, 0.9), sys("b", "f1", 100, 1000, 0)] },
        [conn("a", "b")],
      );
    const w1 = mk();
    await runMigrationProcessor(w1, ctx(0), { ...PARAMS, interval: REFERENCE_INTERVAL });
    const moved1 = 1000 - w1.systems.find((s) => s.id === "a")!.population;

    const w2 = mk();
    await runMigrationProcessor(w2, ctx(0), { ...PARAMS, interval: 2 * REFERENCE_INTERVAL });
    const moved2 = 1000 - w2.systems.find((s) => s.id === "a")!.population;

    expect(moved1).toBeGreaterThan(0);
    expect(moved2).toBeCloseTo(2 * moved1, 5);
  });

  it("moves nothing on an off-boundary tick (monthly pulse)", async () => {
    const world = new InMemoryMigrationWorld(
      { systems: [sys("a", "f1", 1000, 2000, 0.5), sys("b", "f1", 100, 2000, 0)] },
      [conn("a", "b")],
    );
    const before = world.systems.find((s) => s.id === "a")!.population;
    await runMigrationProcessor(world, ctx(1), { ...PARAMS, interval: REFERENCE_INTERVAL }); // tick 1 %24 ≠ 0
    expect(world.systems.find((s) => s.id === "a")!.population).toBe(before);
  });
});
