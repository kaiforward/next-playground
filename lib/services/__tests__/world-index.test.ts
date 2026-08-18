import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { generateWorld } from "@/lib/world/gen";
import { setWorld, clearWorld } from "@/lib/world/store";
import { regionInfos } from "@/lib/services/world-index";
import type { World, WorldSystem } from "@/lib/world/types";

let world: World;

beforeEach(() => {
  world = generateWorld({ systemCount: 60, seed: 21 });
  setWorld(world);
});

afterEach(() => {
  clearWorld();
});

/** Group systems by regionId, preserving world.systems order within each region. */
function groupSystemsByRegion(systems: WorldSystem[]): Map<string, WorldSystem[]> {
  const byRegion = new Map<string, WorldSystem[]>();
  for (const s of systems) {
    const list = byRegion.get(s.regionId) ?? [];
    list.push(s);
    byRegion.set(s.regionId, list);
  }
  return byRegion;
}

describe("regionInfos", () => {
  it("carries each region's own row fields through", () => {
    const infos = regionInfos();
    expect(infos.length).toBe(world.regions.length);
    const region = world.regions[0];
    const info = infos.find((r) => r.id === region.id)!;
    expect(info.name).toBe(region.name);
    expect(info.dominantEconomy).toBe(region.dominantEconomy);
    expect(info.x).toBe(region.x);
    expect(info.y).toBe(region.y);
  });

  it("derives a region's dominant faction from its most-represented owning faction", () => {
    const byRegion = groupSystemsByRegion(world.systems);
    // A region with >=3 systems lets us give one faction a strict majority
    // (2 systems) over a second faction (1 system) without a tie.
    const [majorityRegionId, majoritySystems] = [...byRegion.entries()].find(
      ([, list]) => list.length >= 3,
    )!;

    const factionA = world.factions[0].id;
    const factionB = world.factions[1].id;
    const overrides = new Map<string, string>();
    majoritySystems.forEach((s, i) => {
      overrides.set(s.id, i < majoritySystems.length - 1 ? factionA : factionB);
    });

    const systems = world.systems.map((s) => {
      const factionId = overrides.get(s.id);
      return factionId === undefined ? s : { ...s, factionId };
    });
    setWorld({ ...world, systems });

    const region = regionInfos().find((r) => r.id === majorityRegionId)!;
    expect(region.dominantFactionId).toBe(factionA);
    expect(region.dominantGovernmentType).toBe(
      world.factions.find((f) => f.id === factionA)!.governmentType,
    );
  });

  it("falls back to 'frontier' for a region with no faction-owned systems", () => {
    const byRegion = groupSystemsByRegion(world.systems);
    const [frontierRegionId, frontierSystems] = [...byRegion.entries()].find(
      ([, list]) => list.length >= 1,
    )!;
    const frontierIds = new Set(frontierSystems.map((s) => s.id));

    const systems = world.systems.map((s) =>
      frontierIds.has(s.id) ? { ...s, factionId: null } : s,
    );
    setWorld({ ...world, systems });

    const region = regionInfos().find((r) => r.id === frontierRegionId)!;
    expect(region.dominantFactionId).toBeNull();
    expect(region.dominantGovernmentType).toBe("frontier");
  });

  it("re-derives after a world swap rather than serving the previous world's regions", () => {
    const before = regionInfos();
    setWorld(generateWorld({ systemCount: 90, seed: 7 }));
    const after = regionInfos();
    expect(after.map((r) => r.id)).not.toEqual(before.map((r) => r.id));
  });
});
