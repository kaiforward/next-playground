import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { generateWorld } from "@/lib/world/gen";
import { setWorld, clearWorld, getWorld } from "@/lib/world/store";
import { getDevelopmentBySystem } from "@/lib/services/development-map";
import { developmentPoints } from "@/lib/engine/development-points";
import type { World } from "@/lib/world/types";

let world: World;
beforeAll(() => {
  world = generateWorld({ systemCount: 60, seed: 21 });
  setWorld(world);
});
afterAll(() => clearWorld());

describe("getDevelopmentBySystem", () => {
  it("returns one finite, non-negative development-points reading per system", () => {
    const entries = getDevelopmentBySystem();
    expect(entries).toHaveLength(getWorld().systems.length);
    for (const e of entries) {
      expect(Number.isFinite(e.development)).toBe(true);
      expect(e.development).toBeGreaterThanOrEqual(0);
    }
  });

  it("wires each system's built base + population into developmentPoints (homeworld reads developed)", () => {
    const w = getWorld();
    const faction = w.factions[0];
    if (!faction) throw new Error("expected a seeded faction");
    const homeworldId = faction.homeworldId;
    const s = w.systems.find((x) => x.id === homeworldId)!;
    const buildings: Record<string, number> = {};
    for (const b of w.buildings) if (b.systemId === homeworldId) buildings[b.buildingType] = b.count;
    const expected = developmentPoints({ buildings, population: s.population });
    const entry = getDevelopmentBySystem().find((e) => e.systemId === homeworldId)!;
    expect(entry.development).toBeCloseTo(expected, 10);
    expect(expected).toBeGreaterThan(0); // a seeded homeworld has built out some development
  });
});
