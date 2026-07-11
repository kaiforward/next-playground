import { describe, it, expect } from "vitest";
import { applyDevelopments } from "@/lib/world/tick";
import { emptyResourceVector, unitResourceVector } from "@/lib/engine/resources";
import type { SimSystem } from "@/lib/engine/simulator/types";
import type { SystemDevelopment } from "@/lib/tick/world/directed-build-world";
import { HOUSING_TYPE, POP_CENTRE_DENSITY } from "@/lib/constants/industry";
import { housingPopCap } from "@/lib/engine/industry";

/** Minimal valid SimSystem fixture — only the fields `applyDevelopments` reads/writes matter for
 * this suite; the rest are innocuous placeholders that still type-check. */
function makeSystem(id: string, population: number): SimSystem {
  return {
    id,
    name: id,
    economyType: "agricultural",
    regionId: "region-1",
    factionId: "faction-1",
    control: "controlled",
    governmentType: "federation",
    population,
    popCap: 1000,
    traits: [],
    unrest: 0,
    buildings: {},
    buildingIdleMonths: {},
    yields: unitResourceVector(),
    slotCap: emptyResourceVector(),
    generalSpace: 100,
    habitableSpace: 100,
  };
}

function totalPopulation(systems: SimSystem[]): number {
  return systems.reduce((n, s) => n + s.population, 0);
}

describe("applyDevelopments", () => {
  it("conserves population when two developments share an insufficient source", () => {
    const source = makeSystem("source", 60);
    const targetA = makeSystem("target-a", 0);
    const targetB = makeSystem("target-b", 0);
    const systems = [source, targetA, targetB];
    const developments: SystemDevelopment[] = [
      { systemId: "target-a", sourceSystemId: "source", seedPop: 50, housingLevels: 3 },
      { systemId: "target-b", sourceSystemId: "source", seedPop: 50, housingLevels: 3 },
    ];

    const before = totalPopulation(systems);
    const after = applyDevelopments(systems, developments);

    expect(totalPopulation(after)).toBe(before); // conserved, not minted

    const afterSource = after.find((s) => s.id === "source")!;
    const afterA = after.find((s) => s.id === "target-a")!;
    const afterB = after.find((s) => s.id === "target-b")!;

    expect(afterSource.population).toBeGreaterThanOrEqual(0);
    expect(afterSource.population).toBe(0); // fully drained: 50 to A, remaining 10 to B
    expect(afterA.population).toBe(50);
    expect(afterB.population).toBe(10);
    // Exactly what the source lost was credited to the two targets.
    expect(afterA.population + afterB.population).toBe(before - afterSource.population);

    for (const s of after) {
      expect(Number.isFinite(s.population)).toBe(true);
      expect(s.population).toBeGreaterThanOrEqual(0);
    }
  });

  it("moves the full seed on a single develop with a sufficient source (regression)", () => {
    const source = makeSystem("source", 200);
    const target = makeSystem("target", 0);
    target.control = "controlled";
    target.popCap = 0; // inert controlled system
    const systems = [source, target];
    const developments: SystemDevelopment[] = [
      { systemId: "target", sourceSystemId: "source", seedPop: 50, housingLevels: 3 },
    ];

    const before = totalPopulation(systems);
    const after = applyDevelopments(systems, developments);

    expect(totalPopulation(after)).toBe(before);

    const afterSource = after.find((s) => s.id === "source")!;
    const afterTarget = after.find((s) => s.id === "target")!;
    expect(afterSource.population).toBe(150);
    expect(afterSource.control).toBe("controlled");
    expect(afterTarget.population).toBe(50);
    expect(afterTarget.control).toBe("developed");
    expect(afterTarget.buildings[HOUSING_TYPE]).toBe(3);                       // bundled housing placed
    expect(afterTarget.popCap).toBeGreaterThanOrEqual(afterTarget.population); // viable by construction
    expect(afterTarget.popCap).toBe(housingPopCap({ [HOUSING_TYPE]: 3 }));     // popCap = placed housing

    for (const s of after) {
      expect(Number.isFinite(s.population)).toBe(true);
      expect(s.population).toBeGreaterThanOrEqual(0);
    }
  });

  it("lands a viable colony: housing placed, popCap ≥ seed, source keeps the rest (land-poor seed)", () => {
    const source = makeSystem("source", 500);
    const colony = makeSystem("colony", 0);
    colony.control = "controlled";
    colony.popCap = 0;
    colony.buildings = {};
    const systems = [source, colony];
    // A land-poor seed of 25 (below one full housing level's density) with a single bundled housing level.
    const developments: SystemDevelopment[] = [
      { systemId: "colony", sourceSystemId: "source", seedPop: 25, housingLevels: 2, },
    ];
    const after = applyDevelopments(systems, developments);
    const c = after.find((s) => s.id === "colony")!;
    const src = after.find((s) => s.id === "source")!;
    expect(c.control).toBe("developed");
    expect(c.population).toBe(25);
    expect(c.buildings[HOUSING_TYPE]).toBe(2);
    expect(c.popCap).toBe(2 * POP_CENTRE_DENSITY);
    expect(c.popCap).toBeGreaterThanOrEqual(c.population); // no popCap≈0 stranded state
    expect(src.population).toBe(475);                       // conserved: 500 − 25
    for (const s of after) expect(Number.isFinite(s.popCap)).toBe(true);
  });
});
