import { describe, it, expect } from "vitest";
import { createSimWorld } from "@/lib/engine/simulator/world";
import { DEFAULT_SIM_CONSTANTS } from "@/lib/engine/simulator/constants";
import type { SimConfig } from "@/lib/engine/simulator/types";

describe("createSimWorld faction identity", () => {
  it("assigns every system a non-null factionId", () => {
    const config: SimConfig = { tickCount: 1, bots: [], seed: 42 };
    const world = createSimWorld(config, DEFAULT_SIM_CONSTANTS);
    expect(world.systems.length).toBeGreaterThan(0);
    for (const s of world.systems) {
      expect(typeof s.factionId).toBe("string");
      expect(s.factionId).not.toBeNull();
    }
  });

  it("co-assigns systems of the same faction the same factionId", () => {
    const config: SimConfig = { tickCount: 1, bots: [], seed: 42 };
    const world = createSimWorld(config, DEFAULT_SIM_CONSTANTS);
    const byGov = new Map<string, Set<string>>();
    for (const s of world.systems) {
      // factionId is finer-grained than government; this just asserts it is stable + grouped
      const set = byGov.get(s.factionId ?? "") ?? new Set();
      set.add(s.id);
      byGov.set(s.factionId ?? "", set);
    }
    expect(byGov.size).toBeGreaterThan(1); // multiple factions exist
    // …and factionId actually groups: at least one faction owns multiple systems.
    expect([...byGov.values()].some((set) => set.size > 1)).toBe(true);
  });
});
