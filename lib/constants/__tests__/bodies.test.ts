import { describe, it, expect } from "vitest";
import {
  BODY_ARCHETYPES, SUN_CLASSES, RICHNESS_MODIFIERS, RESOURCE_TYPES,
} from "../bodies";
import type { BodyArchetypeId, ResourceType, SunClass } from "@/lib/types/game";

const ARCHETYPE_IDS = Object.keys(BODY_ARCHETYPES) as BodyArchetypeId[];
const SUN_CLASS_IDS = Object.keys(SUN_CLASSES) as SunClass[];

describe("BODY_ARCHETYPES", () => {
  it("every archetype defines all seven resource types", () => {
    for (const id of ARCHETYPE_IDS) {
      const keys = Object.keys(BODY_ARCHETYPES[id].resourceBase).sort();
      expect(keys).toEqual([...RESOURCE_TYPES].sort());
    }
  });

  it("every archetype has a positive pop-cap weight and a defined habitability", () => {
    for (const id of ARCHETYPE_IDS) {
      expect(BODY_ARCHETYPES[id].popCapWeight).toBeGreaterThan(0);
      expect(typeof BODY_ARCHETYPES[id].habitable).toBe("boolean");
    }
  });

  it("the id key matches the entry's id field", () => {
    for (const id of ARCHETYPE_IDS) expect(BODY_ARCHETYPES[id].id).toBe(id);
  });

  it("volcanic_world is the only archetype with a nonzero danger baseline", () => {
    expect(BODY_ARCHETYPES.volcanic_world.dangerBaseline).toBe(0.05);
    for (const id of ARCHETYPE_IDS.filter((a) => a !== "volcanic_world")) {
      expect(BODY_ARCHETYPES[id].dangerBaseline).toBe(0);
    }
  });
});

describe("SUN_CLASSES", () => {
  it("every class has a positive weight and a sane body-count band", () => {
    for (const id of SUN_CLASS_IDS) {
      const c = SUN_CLASSES[id];
      expect(c.weight).toBeGreaterThan(0);
      expect(c.bodyCount.min).toBeGreaterThanOrEqual(1);
      expect(c.bodyCount.max).toBeGreaterThanOrEqual(c.bodyCount.min);
    }
  });

  it("archetype weights reference valid archetypes, are non-negative, and at least one is positive", () => {
    for (const id of SUN_CLASS_IDS) {
      const weights = SUN_CLASSES[id].archetypeWeights;
      let anyPositive = false;
      for (const [arch, w] of Object.entries(weights)) {
        expect(ARCHETYPE_IDS).toContain(arch);
        expect(w).toBeGreaterThanOrEqual(0);
        if (w > 0) anyPositive = true;
      }
      expect(anyPositive).toBe(true);
    }
  });
});

describe("RICHNESS_MODIFIERS", () => {
  it("every modifier targets a valid resource, multiplies > 1, and has positive rarity", () => {
    const resourceSet = new Set<ResourceType>(RESOURCE_TYPES);
    for (const [id, mod] of Object.entries(RICHNESS_MODIFIERS)) {
      expect(mod.id).toBe(id);
      expect(resourceSet.has(mod.resource)).toBe(true);
      expect(mod.multiplier).toBeGreaterThan(1);
      expect(mod.rarity).toBeGreaterThan(0);
    }
  });
});
