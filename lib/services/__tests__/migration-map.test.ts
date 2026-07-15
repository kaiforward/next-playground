import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { generateWorld } from "@/lib/world/gen";
import { setWorld, clearWorld } from "@/lib/world/store";
import { getMigrationBySystem } from "@/lib/services/migration-map";
import { migrationAttractiveness } from "@/lib/engine/migration";
import { labourDemand } from "@/lib/engine/industry";
import { MIGRATION_PARAMS } from "@/lib/constants/population";
import type { World, WorldSystem, WorldBuilding } from "@/lib/world/types";

let world: World;

beforeEach(() => {
  world = generateWorld({ systemCount: 60, seed: 15 });
  setWorld(world);
});

afterEach(() => {
  clearWorld();
});

describe("getMigrationBySystem", () => {
  it("returns one entry per developed system only, excluding undeveloped systems", () => {
    const [a, b, c] = world.systems;
    const systems: WorldSystem[] = world.systems.map((s) => {
      if (s.id === a.id) return { ...s, control: "developed" };
      if (s.id === b.id) return { ...s, control: "developed" };
      if (s.id === c.id) return { ...s, control: "unclaimed" };
      return s;
    });
    setWorld({ ...world, systems });

    const entries = getMigrationBySystem();
    const developedCount = systems.filter((s) => s.control === "developed").length;
    expect(entries).toHaveLength(developedCount);
    expect(entries.some((e) => e.systemId === c.id)).toBe(false);
    expect(entries.some((e) => e.systemId === a.id)).toBe(true);
    expect(entries.some((e) => e.systemId === b.id)).toBe(true);
  });

  it("computes attraction via the real migrationAttractiveness + MIGRATION_PARAMS.weights", () => {
    const developed = world.systems.find((s) => s.control === "developed");
    if (!developed) throw new Error("expected a seeded developed system");

    const buildings: Record<string, number> = {};
    for (const b of world.buildings) if (b.systemId === developed.id) buildings[b.buildingType] = b.count;

    const expected = migrationAttractiveness(
      {
        unrest: developed.unrest,
        population: developed.population,
        popCap: developed.popCap,
        labourDemand: labourDemand(buildings),
      },
      MIGRATION_PARAMS.weights,
    );

    const entry = getMigrationBySystem().find((e) => e.systemId === developed.id)!;
    expect(entry.attraction).toBeCloseTo(expected, 10);
  });

  it("scores a fully-attractive system (empty, calm, job-rich) above a repulsive one (full, unrest, jobless)", () => {
    const [attractiveBase, repulsiveBase] = world.systems;
    const attractiveId = attractiveBase.id;
    const repulsiveId = repulsiveBase.id;

    const systems: WorldSystem[] = world.systems.map((s) => {
      if (s.id === attractiveId) return { ...s, control: "developed", unrest: 0, population: 0, popCap: 1000 };
      if (s.id === repulsiveId) return { ...s, control: "developed", unrest: 1, population: 500, popCap: 500 };
      return s;
    });
    const buildings: WorldBuilding[] = [
      ...world.buildings.filter((b) => b.systemId !== attractiveId && b.systemId !== repulsiveId),
      { systemId: attractiveId, buildingType: "vocational_school", count: 5, idleMonths: 0 },
    ];
    setWorld({ ...world, systems, buildings });

    const entries = getMigrationBySystem();
    const attractive = entries.find((e) => e.systemId === attractiveId)!;
    const repulsive = entries.find((e) => e.systemId === repulsiveId)!;
    expect(attractive.attraction).toBeGreaterThan(repulsive.attraction);
  });
});
