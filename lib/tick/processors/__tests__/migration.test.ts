import { describe, it, expect } from "vitest";
import { runMigrationProcessor } from "../migration";
import { InMemoryMigrationWorld } from "@/lib/tick/adapters/memory/migration";
import { REFERENCE_INTERVAL } from "@/lib/constants/tick-cadence";
import type { TickContext } from "@/lib/tick/types";
import type { TickConnection, TickSystem } from "@/lib/tick/rows";
import { unitResourceVector, emptyResourceVector } from "@/lib/engine/resources";

const OFF = 100; // employedGradientThreshold above any achievable |gradient| ⇒ staffed migration off
// Colonist delivery disabled (sourceOutflowCap 0) so these cases isolate edge diffusion; delivery has its
// own engine tests and a dedicated processor case below.
const NO_DELIVERY = { sourceOutflowCap: 0, minSourcePopulation: 1e9 };
const PARAMS = {
  interval: REFERENCE_INTERVAL, // catch-up factor 1 → calibrated per-edge magnitudes
  flow: { weights: { contentment: 1, headroom: 1, jobs: 1 }, maxOutflowFraction: 0.1, gradientThreshold: 0.01, distanceDecay: 0.1, employedGradientThreshold: OFF, employedLeakFraction: 0 },
  delivery: NO_DELIVERY,
};

// Migration is now a monthly pulse: all edges process on ticks where tick % interval === 0.
const EDGE_TICK = 0;

// A tier-0 production building demands 10 heads/unit (labourTotal), so `{ food: 100 }` opens
// 1000 jobs — enough headroom for the destination to absorb the migrants each case moves.
const JOBS = { food: 100 };

function sys(id: string, factionId: string | null, population: number, popCap: number, unrest: number, buildings: Record<string, number> = {}): TickSystem {
  return {
    id, name: id, economyType: "extraction", regionId: "r1", factionId,
    control: factionId ? "developed" : "unclaimed", governmentType: "federation",
    population, popCap, unrest, buildings, buildingIdleMonths: {}, buildingCollapseDebt: {},
    yields: unitResourceVector(), slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0,
  };
}
const conn = (a: string, b: string, fuelCost = 10): TickConnection => ({ fromSystemId: a, toSystemId: b, fuelCost });
const ctx = (tick: number): TickContext => ({ tick, results: new Map() });

describe("migration processor", () => {
  it("relocates population from a tense full system to a calm roomy neighbour, conserved", async () => {
    const systems = [sys("a", "f1", 1000, 1000, 0.9), sys("b", "f1", 100, 1000, 0, JOBS)];
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
    const systems = [sys("a", "f1", 1500, 1000, 0), sys("b", "f1", 100, 1000, 0, JOBS)];
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
        { systems: [sys("a", "f1", 1000, 1000, 0.9), sys("b", "f1", 100, 1000, 0, JOBS)] },
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

  it("delivers colonists from a developed source to an empty colony (water-filled), conserved", async () => {
    // Diffusion disabled (maxOutflowFraction 0) so this isolates the colonist-delivery pass: the core's
    // idle spare is water-filled into the empty colony, even though diffusion alone would move nothing.
    const systems = [sys("core", "f1", 1000, 1000, 0), sys("colony", "f1", 10, 1000, 0)];
    const world = new InMemoryMigrationWorld({ systems }, [conn("core", "colony")]);
    const before = world.systems.reduce((s, x) => s + x.population, 0);
    const params = {
      ...PARAMS,
      flow: { ...PARAMS.flow, maxOutflowFraction: 0 },
      delivery: { sourceOutflowCap: 0.05, minSourcePopulation: 100 },
    };
    await runMigrationProcessor(world, ctx(EDGE_TICK), params);
    expect(world.systems.find((s) => s.id === "core")!.population).toBeLessThan(1000);   // donated spare
    expect(world.systems.find((s) => s.id === "colony")!.population).toBeGreaterThan(10); // received settlers
    expect(world.systems.reduce((s, x) => s + x.population, 0)).toBeCloseTo(before, 5);   // conserved
  });

  it("skips colonist delivery on an off-boundary tick (delivery is monthly-gated)", async () => {
    // Same source + empty colony and the real delivery params that DO move people on a pulse boundary (the
    // case above), but run on an off-boundary tick: the monthly-pulse gate must skip the whole processor,
    // so delivery moves nobody. Guards the delivery pass from drifting above the pulse guard (a 24× rate).
    const systems = [sys("core", "f1", 1000, 1000, 0), sys("colony", "f1", 10, 1000, 0)];
    const world = new InMemoryMigrationWorld({ systems }, [conn("core", "colony")]);
    const params = { ...PARAMS, delivery: { sourceOutflowCap: 0.05, minSourcePopulation: 100 } };
    await runMigrationProcessor(world, ctx(1), params); // tick 1 % 24 ≠ 0 → off-boundary, whole pulse skipped
    expect(world.systems.find((s) => s.id === "core")!.population).toBe(1000);
    expect(world.systems.find((s) => s.id === "colony")!.population).toBe(10);
  });
});
