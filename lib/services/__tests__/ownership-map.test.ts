import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { generateWorld } from "@/lib/world/gen";
import { setWorld, clearWorld } from "@/lib/world/store";
import { getOwnershipBySystem } from "@/lib/services/ownership-map";
import type { World } from "@/lib/world/types";

let world: World;

beforeEach(() => {
  world = generateWorld({ systemCount: 60, seed: 15 });
  setWorld(world);
});

afterEach(() => {
  clearWorld();
});

describe("getOwnershipBySystem", () => {
  it("returns per-system factionId + developed (control === 'developed') for every system", () => {
    const entries = getOwnershipBySystem();
    expect(entries).toHaveLength(world.systems.length);

    const byId = new Map(entries.map((e) => [e.systemId, e] as const));
    for (const s of world.systems) {
      const e = byId.get(s.id);
      expect(e).toBeDefined();
      expect(e?.factionId).toBe(s.factionId);
      expect(e?.developed).toBe(s.control === "developed");
    }
  });

  it("marks exactly the faction homeworlds as developed at world-gen", () => {
    const entries = getOwnershipBySystem();
    const developed = entries.filter((e) => e.developed);
    expect(developed.length).toBe(world.factions.length);

    const homeworldIds = new Set(world.factions.map((f) => f.homeworldId));
    for (const e of developed) {
      expect(homeworldIds.has(e.systemId)).toBe(true);
    }
  });
});
