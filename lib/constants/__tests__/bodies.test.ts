import { describe, it, expect } from "vitest";
import {
  BODY_ARCHETYPES, SUN_CLASSES, RESOURCE_TYPES,
} from "../bodies";
import type { BodyArchetypeId, SunClass } from "@/lib/types/game";

const ARCHETYPE_IDS = Object.keys(BODY_ARCHETYPES) as BodyArchetypeId[];
const SUN_CLASS_IDS = Object.keys(SUN_CLASSES) as SunClass[];

describe("BODY_ARCHETYPES", () => {
  it("every archetype's depositCounts keys are valid resource types with integer, min ≤ max ranges", () => {
    for (const id of ARCHETYPE_IDS) {
      for (const [resource, range] of Object.entries(BODY_ARCHETYPES[id].depositCounts)) {
        expect(RESOURCE_TYPES).toContain(resource);
        expect(range).toBeDefined();
        if (!range) continue;
        expect(Number.isInteger(range.min)).toBe(true);
        expect(Number.isInteger(range.max)).toBe(true);
        expect(range.min).toBeGreaterThanOrEqual(0);
        expect(range.max).toBeGreaterThanOrEqual(range.min);
      }
    }
  });

  it("every archetype has a default-pop score in [0, 1] and min ≤ max people/industry land", () => {
    for (const id of ARCHETYPE_IDS) {
      const arch = BODY_ARCHETYPES[id];
      expect(arch.scores.default).toBeGreaterThanOrEqual(0);
      expect(arch.scores.default).toBeLessThanOrEqual(1);
      expect(arch.peopleLand.min).toBeGreaterThanOrEqual(0);
      expect(arch.peopleLand.max).toBeGreaterThanOrEqual(arch.peopleLand.min);
      expect(arch.industryLand.min).toBeGreaterThanOrEqual(0);
      expect(arch.industryLand.max).toBeGreaterThanOrEqual(arch.industryLand.min);
      expect(arch.extractionModifier).toBeGreaterThan(0);
      expect(arch.extractionModifier).toBeLessThanOrEqual(1);
      expect(typeof arch.techLocked).toBe("boolean");
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
