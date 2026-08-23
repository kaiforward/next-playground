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
  inflowBlockedSystemIds: new Set<string>(),
};

// Migration is now a cycle start: all edges process on ticks where tick % interval === 0.
const EDGE_TICK = 0;

// A tier-0 production building demands 10 heads/unit (labourTotal), so `{ food: 100 }` opens
// 1000 jobs — enough headroom for the destination to absorb the migrants each case moves.
const JOBS = { food: 100 };

function sys(id: string, factionId: string | null, population: number, popCap: number, unrest: number, buildings: Record<string, number> = {}): TickSystem {
  return {
    id, name: id, economyType: "extraction", regionId: "r1", factionId,
    control: factionId ? "developed" : "unclaimed", governmentType: "federation",
    population, popCap, unrest, buildings, buildingIdleCycles: {}, collapseDebt: 0,
    yields: unitResourceVector(), extractionEff: unitResourceVector(),
    depositCounts: emptyResourceVector(), industryLand: 0, peopleLand: 0,
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

  it("moves nothing on an off-boundary tick (cycle start)", async () => {
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

  it("skips colonist delivery on an off-boundary tick (delivery is cycle-gated)", async () => {
    // Same source + empty colony and the real delivery params that DO move people on a cycle boundary (the
    // case above), but run on an off-boundary tick: the cycle-start gate must skip the whole processor,
    // so delivery moves nobody. Guards the delivery pass from drifting above the cycle-start guard (a 24× rate).
    const systems = [sys("core", "f1", 1000, 1000, 0), sys("colony", "f1", 10, 1000, 0)];
    const world = new InMemoryMigrationWorld({ systems }, [conn("core", "colony")]);
    const params = { ...PARAMS, delivery: { sourceOutflowCap: 0.05, minSourcePopulation: 100 } };
    await runMigrationProcessor(world, ctx(1), params); // tick 1 % 24 ≠ 0 → off-boundary, whole cycle skipped
    expect(world.systems.find((s) => s.id === "core")!.population).toBe(1000);
    expect(world.systems.find((s) => s.id === "colony")!.population).toBe(10);
  });
});

describe("migration processor: famine inflow gate (abandonment Rule 1)", () => {
  it("blocks colonist delivery into a famine sink while diffusion stays off (isolates delivery)", async () => {
    const systems = [sys("core", "f1", 1000, 1000, 0), sys("colony", "f1", 10, 1000, 0)];
    const world = new InMemoryMigrationWorld({ systems }, [conn("core", "colony")]);
    const params = {
      ...PARAMS,
      flow: { ...PARAMS.flow, maxOutflowFraction: 0 },
      delivery: { sourceOutflowCap: 0.05, minSourcePopulation: 100 },
      inflowBlockedSystemIds: new Set(["colony"]),
    };
    await runMigrationProcessor(world, ctx(EDGE_TICK), params);
    expect(world.systems.find((s) => s.id === "colony")!.population).toBe(10); // no inflow received
  });

  it("blocks diffusion into a famine destination while its outflow (donation) is untouched", async () => {
    // The famine system ("a") is also the more attractive endpoint were it not blocked — flip the
    // roles from the ordinary diffusion case: a calm famine world would otherwise pull in "b"'s spare.
    const systems = [sys("a", "f1", 100, 1000, 0, JOBS), sys("b", "f1", 1000, 1000, 0.9)];
    const world = new InMemoryMigrationWorld({ systems }, [conn("a", "b")]);
    const params = { ...PARAMS, inflowBlockedSystemIds: new Set(["a"]) };
    await runMigrationProcessor(world, ctx(EDGE_TICK), params);
    expect(world.systems.find((s) => s.id === "a")!.population).toBe(100); // blocked as a destination
  });

  it("still lets a famine system's outflow (donation/exodus) run — the gate blocks inflow only", async () => {
    // "a" is overshot and calm — migration drains it toward "b" regardless of "a" being famine-flagged,
    // since the flag only zeroes DESTINATION headroom, never a source's outflow.
    const systems = [sys("a", "f1", 1500, 1000, 0), sys("b", "f1", 100, 1000, 0, JOBS)];
    const world = new InMemoryMigrationWorld({ systems }, [conn("a", "b")]);
    const before = world.systems.reduce((s, x) => s + x.population, 0);
    const params = { ...PARAMS, inflowBlockedSystemIds: new Set(["a"]) };
    await runMigrationProcessor(world, ctx(EDGE_TICK), params);
    expect(world.systems.find((s) => s.id === "a")!.population).toBeLessThan(1500); // still donates/exodus
    expect(world.systems.reduce((s, x) => s + x.population, 0)).toBeCloseTo(before, 5); // conserved
  });
});

describe("migration throughput instrumentation (migrationMoved)", () => {
  it("sums colonist deliveries and edge diffusion into separate migrationMoved fields when both occur", async () => {
    const systems = [
      sys("core", "f1", 1000, 1000, 0),   // delivery source
      sys("colony", "f1", 10, 1000, 0),   // delivery sink
      sys("a", "f1", 1000, 1000, 0.9),    // diffusion source
      sys("b", "f1", 100, 1000, 0, JOBS), // diffusion sink
    ];
    const world = new InMemoryMigrationWorld(
      { systems },
      [conn("core", "colony"), conn("a", "b")],
    );
    const params = { ...PARAMS, delivery: { sourceOutflowCap: 0.05, minSourcePopulation: 100 } };
    const result = await runMigrationProcessor(world, ctx(EDGE_TICK), params);
    expect(result.migrationMoved?.colonists).toBeGreaterThan(0);
    expect(result.migrationMoved?.diffusion).toBeGreaterThan(0);
  });

  it("reports no migrationMoved on an off-boundary tick", async () => {
    const world = new InMemoryMigrationWorld(
      { systems: [sys("a", "f1", 1000, 2000, 0.5), sys("b", "f1", 100, 2000, 0)] },
      [conn("a", "b")],
    );
    const result = await runMigrationProcessor(world, ctx(1), { ...PARAMS, interval: REFERENCE_INTERVAL });
    expect(result.migrationMoved).toBeUndefined();
  });

  it("migrationMoved.diffusion equals exactly the population edge diffusion displaced — conserved, no growth/death padding", async () => {
    const systems = [sys("a", "f1", 1000, 1000, 0.9), sys("b", "f1", 100, 1000, 0, JOBS)];
    const world = new InMemoryMigrationWorld({ systems }, [conn("a", "b")]);
    const before = world.systems.find((s) => s.id === "a")!.population;
    const result = await runMigrationProcessor(world, ctx(EDGE_TICK), PARAMS); // PARAMS uses NO_DELIVERY → colonists 0
    const after = world.systems.find((s) => s.id === "a")!.population;
    expect(result.migrationMoved?.colonists).toBe(0);
    expect(result.migrationMoved?.diffusion).toBeCloseTo(before - after, 5);
  });

  it("migrationMoved.colonists equals exactly the population colonist delivery moved — conserved, no growth/death padding", async () => {
    const systems = [sys("core", "f1", 1000, 1000, 0), sys("colony", "f1", 10, 1000, 0)];
    const world = new InMemoryMigrationWorld({ systems }, [conn("core", "colony")]);
    const params = {
      ...PARAMS,
      flow: { ...PARAMS.flow, maxOutflowFraction: 0 }, // isolates delivery — diffusion contributes nothing
      delivery: { sourceOutflowCap: 0.05, minSourcePopulation: 100 },
    };
    const before = world.systems.find((s) => s.id === "colony")!.population;
    const result = await runMigrationProcessor(world, ctx(EDGE_TICK), params);
    const after = world.systems.find((s) => s.id === "colony")!.population;
    expect(result.migrationMoved?.diffusion).toBe(0);
    expect(result.migrationMoved?.colonists).toBeCloseTo(after - before, 5);
  });
});
