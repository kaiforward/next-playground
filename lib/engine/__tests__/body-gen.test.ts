import { describe, it, expect } from "vitest";
import { mulberry32 } from "../universe-gen";
import { generateSubstrate, FEATURE_TRAIT_IDS } from "../body-gen";
import { SUN_CLASSES, RICHNESS_MODIFIERS, BODY_ARCHETYPES } from "@/lib/constants/bodies";
import { RESOURCE_TYPES } from "../resources";
import { isFeatureTrait } from "@/lib/utils/traits";

function sample(n: number) {
  const rng = mulberry32(42);
  return Array.from({ length: n }, () => generateSubstrate(rng));
}

describe("FEATURE_TRAIT_IDS", () => {
  it("is exactly the 31 narrative survivors", () => {
    expect(FEATURE_TRAIT_IDS.length).toBe(31);
    for (const id of FEATURE_TRAIT_IDS) expect(isFeatureTrait(id)).toBe(true);
  });
});

describe("generateSubstrate", () => {
  it("rolls a valid sun class and at least one body", () => {
    for (const s of sample(200)) {
      expect(SUN_CLASSES[s.sunClass]).toBeDefined();
      expect(s.bodies.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("only rolls archetypes the sun class permits", () => {
    for (const s of sample(200)) {
      const weights = SUN_CLASSES[s.sunClass].archetypeWeights;
      for (const b of s.bodies) expect(weights[b.bodyType] ?? 0).toBeGreaterThan(0);
    }
  });

  it("body sizes fall in the configured band", () => {
    for (const s of sample(100)) {
      for (const b of s.bodies) {
        expect(b.size).toBeGreaterThanOrEqual(0.5);
        expect(b.size).toBeLessThanOrEqual(1.5);
      }
    }
  });

  it("aggregate equals the element-wise sum of body resource bases", () => {
    for (const s of sample(50)) {
      for (const type of RESOURCE_TYPES) {
        const summed = s.bodies.reduce((acc, b) => acc + b.resourceBase[type], 0);
        expect(s.aggregate[type]).toBeCloseTo(summed, 6);
      }
    }
  });

  it("seeds population between 0 and pop cap", () => {
    for (const s of sample(200)) {
      expect(s.population).toBeGreaterThanOrEqual(0);
      expect(s.population).toBeLessThanOrEqual(s.popCap);
    }
  });

  it("rolls 0–2 features, all narrative survivors, no duplicates", () => {
    for (const s of sample(200)) {
      expect(s.features.length).toBeGreaterThanOrEqual(0);
      expect(s.features.length).toBeLessThanOrEqual(2);
      const ids = s.features.map((f) => f.traitId);
      expect(new Set(ids).size).toBe(ids.length);
      for (const f of s.features) expect(isFeatureTrait(f.traitId)).toBe(true);
    }
  });

  it("bodyDanger sums the body archetype danger baselines", () => {
    for (const s of sample(300)) {
      const expected = s.bodies.reduce(
        (sum, b) => sum + BODY_ARCHETYPES[b.bodyType].dangerBaseline,
        0,
      );
      expect(s.bodyDanger).toBeCloseTo(expected, 6);
      // Only volcanic_world carries a baseline (0.05); danger-free systems are 0.
      const hasVolcanic = s.bodies.some((b) => b.bodyType === "volcanic_world");
      if (hasVolcanic) expect(s.bodyDanger).toBeGreaterThan(0);
      else expect(s.bodyDanger).toBe(0);
    }
  });

  it("richness modifiers only target a resource present on the body", () => {
    for (const s of sample(300)) {
      for (const b of s.bodies) {
        for (const modId of b.richnessModifiers) {
          expect(b.resourceBase[RICHNESS_MODIFIERS[modId].resource]).toBeGreaterThan(0);
        }
      }
    }
  });

  it("is deterministic for the same seed", () => {
    const a = generateSubstrate(mulberry32(7));
    const b = generateSubstrate(mulberry32(7));
    expect(a).toEqual(b);
  });
});
