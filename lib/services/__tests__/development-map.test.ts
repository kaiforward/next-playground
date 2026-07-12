import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { generateWorld } from "@/lib/world/gen";
import { setWorld, clearWorld, getWorld } from "@/lib/world/store";
import { getDevelopmentBySystem } from "@/lib/services/development-map";
import { systemDevelopment } from "@/lib/engine/development";
import type { World } from "@/lib/world/types";

let world: World;
beforeAll(() => {
  world = generateWorld({ systemCount: 60, seed: 21 });
  setWorld(world);
});
afterAll(() => clearWorld());

describe("getDevelopmentBySystem", () => {
  it("returns one development reading per system, each in [0,1]", () => {
    const entries = getDevelopmentBySystem();
    expect(entries).toHaveLength(getWorld().systems.length);
    for (const e of entries) {
      expect(e.development).toBeGreaterThanOrEqual(0);
      expect(e.development).toBeLessThanOrEqual(1);
    }
  });

  it("wires each system's world substrate into systemDevelopment (homeworld reads developed)", () => {
    const w = getWorld();
    const homeworldId = w.factions[0]!.homeworldId;
    const s = w.systems.find((x) => x.id === homeworldId)!;
    const buildings: Record<string, number> = {};
    for (const b of w.buildings) if (b.systemId === homeworldId) buildings[b.buildingType] = b.count;
    const expected = systemDevelopment({
      buildings,
      population: s.population,
      habitableSpace: s.habitableSpace,
    });
    const entry = getDevelopmentBySystem().find((e) => e.systemId === homeworldId)!;
    expect(entry.development).toBeCloseTo(expected, 10);
    expect(expected).toBeGreaterThan(0); // a seeded homeworld has built out some development
  });
});
