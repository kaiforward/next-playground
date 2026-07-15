import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { generateWorld } from "@/lib/world/gen";
import { setWorld, clearWorld } from "@/lib/world/store";
import { getFactionVitals } from "@/lib/services/faction-vitals";
import { ServiceError } from "@/lib/services/errors";
import type { World } from "@/lib/world/types";

let world: World;

/**
 * Give `factionId` EXACTLY the listed systems (developed, with the given population/unrest) and strip
 * that faction from every other system — a fresh world hasn't run the claim/develop pulse, so a
 * faction owns ~1 system; this seeds a deterministic multi-system faction to aggregate over.
 */
function seedFaction(
  w: World,
  factionId: string,
  rows: { id: string; population: number; unrest: number }[],
): World {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const other = w.factions.find((f) => f.id !== factionId)!.id;
  return {
    ...w,
    systems: w.systems.map((s) => {
      const row = byId.get(s.id);
      if (row) {
        return { ...s, factionId, control: "developed", population: row.population, unrest: row.unrest };
      }
      return s.factionId === factionId ? { ...s, factionId: other } : s;
    }),
  };
}

beforeEach(() => {
  world = generateWorld({ systemCount: 80, seed: 21 });
  setWorld(world);
});

afterEach(() => {
  clearWorld();
});

describe("getFactionVitals", () => {
  it("rolls population and development up as SUMS across the faction's active systems", () => {
    const target = world.factions[0].id;
    const ids = world.systems.slice(0, 4).map((s) => s.id);
    setWorld(seedFaction(world, target, ids.map((id) => ({ id, population: 500, unrest: 0.2 }))));

    const v = getFactionVitals(target);
    expect(v.territorySize).toBe(4);
    expect(v.activeSystemCount).toBe(4);
    expect(v.population).toBe(2000); // 4 × 500
    expect(v.developmentPoints).toBeGreaterThan(0);
    expect(v.developmentPotential).toBeGreaterThan(0);
    expect(v.developmentPct).toBeGreaterThanOrEqual(0);
    expect(v.developmentPct).toBeLessThanOrEqual(100);
  });

  it("weights stability by population — a huge stable capital is not dragged down by small outposts", () => {
    const target = world.factions[0].id;
    const [cap, a, b] = world.systems.slice(0, 3).map((s) => s.id);
    setWorld(
      seedFaction(world, target, [
        { id: cap, population: 10_000, unrest: 0.0 }, // fully stable capital
        { id: a, population: 100, unrest: 0.6 }, // small, 40% stable
        { id: b, population: 100, unrest: 0.6 },
      ]),
    );

    const v = getFactionVitals(target);
    expect(v.activeSystemCount).toBe(3);
    expect(v.population).toBe(10_200);
    // Pop-weighted stability ≈ (10000·1.0 + 200·0.4) / 10200 ≈ 99.2%; a plain mean would be ~60%.
    expect(v.stabilityPct).toBeGreaterThan(90);
  });

  it("reports 0 stability/population (not NaN) for a faction that owns only inactive systems", () => {
    const target = world.factions[0].id;
    const ids = world.systems.slice(0, 2).map((s) => s.id);
    const other = world.factions.find((f) => f.id !== target)!.id;
    setWorld({
      ...world,
      systems: world.systems.map((s) => {
        if (ids.includes(s.id)) return { ...s, factionId: target, control: "controlled" };
        return s.factionId === target ? { ...s, factionId: other } : s;
      }),
    });

    const v = getFactionVitals(target);
    expect(v.territorySize).toBe(2); // owned…
    expect(v.activeSystemCount).toBe(0); // …but none developed
    expect(v.population).toBe(0);
    expect(v.stabilityPct).toBe(0);
    expect(v.developmentPct).toBe(0);
    expect(Number.isNaN(v.stabilityPct)).toBe(false);
  });

  it("throws ServiceError(404) for an unknown faction", () => {
    expect(() => getFactionVitals("does-not-exist")).toThrow(ServiceError);
    try {
      getFactionVitals("does-not-exist");
    } catch (error) {
      expect(error).toMatchObject({ status: 404 });
    }
  });
});
