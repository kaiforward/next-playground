import { describe, it, expect } from "vitest";
import { mulberry32 } from "../universe-gen";
import { generateSubstrate } from "../body-gen";
import { SUN_CLASSES, RICHNESS_MODIFIERS, BODY_ARCHETYPES } from "@/lib/constants/bodies";
import { ALL_TRAIT_IDS } from "@/lib/constants/traits";
import { RESOURCE_TYPES, sumResourceVectors } from "../resources";
import { bodyBuildSpace, housingPopCap, buildSpaceUsed } from "@/lib/engine/industry";
import { SUBSTRATE_GEN } from "@/lib/constants/substrate-gen";

// Quality band overall range (across all bands: poor.min=0.4 … rich.max=2.5)
const QUALITY_MIN = 0.4;
const QUALITY_MAX = 2.5;

function sample(n: number) {
  const rng = mulberry32(42);
  return Array.from({ length: n }, () => generateSubstrate(rng));
}

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
      for (const f of s.features) expect(ALL_TRAIT_IDS).toContain(f.traitId);
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

describe("generateSubstrate — industrial base", () => {
  it("emits a buildSpace equal to the sum of body contributions", () => {
    const sub = generateSubstrate(mulberry32(7));
    const expected = sub.bodies.reduce((s, b) => s + bodyBuildSpace(b.size, b.habitable), 0);
    expect(sub.buildSpace).toBeCloseTo(expected, 6);
  });

  it("emits a buildings map within the build-space budget", () => {
    const sub = generateSubstrate(mulberry32(8));
    expect(buildSpaceUsed(sub.buildings)).toBeLessThanOrEqual(sub.buildSpace + 1e-6);
  });

  it("folds housing into popCap (popCap ≥ body baseline)", () => {
    const sub = generateSubstrate(mulberry32(9));
    expect(sub.popCap).toBeGreaterThanOrEqual(housingPopCap(sub.buildings) - 1e-6);
  });

  it("seeds population at or below popCap", () => {
    const sub = generateSubstrate(mulberry32(10));
    expect(sub.population).toBeLessThanOrEqual(sub.popCap + 1e-6);
  });
});

describe("generateSubstrate — new available-space aggregates (P2)", () => {
  function sampleNew(n: number) {
    const rng = mulberry32(99);
    return Array.from({ length: n }, () => generateSubstrate(rng));
  }

  it("every body has slots and quality as full ResourceVectors with numeric generalSpace/habitableSpace", () => {
    for (const s of sampleNew(50)) {
      for (const b of s.bodies) {
        expect(b.slots).toBeDefined();
        expect(b.quality).toBeDefined();
        expect(typeof b.generalSpace).toBe("number");
        expect(typeof b.habitableSpace).toBe("number");
        // All resource types are present on the vectors
        for (const r of RESOURCE_TYPES) {
          expect(typeof b.slots[r]).toBe("number");
          expect(typeof b.quality[r]).toBe("number");
        }
      }
    }
  });

  it("slots[r] === 0 and quality[r] === 0 for resources absent on the archetype", () => {
    for (const s of sampleNew(100)) {
      for (const b of s.bodies) {
        const arch = BODY_ARCHETYPES[b.bodyType];
        for (const r of RESOURCE_TYPES) {
          if (arch.resourceBase[r] === 0) {
            expect(b.slots[r]).toBe(0);
            expect(b.quality[r]).toBe(0);
          }
        }
      }
    }
  });

  it("quality[r] > 0 only for present resources and within the overall band range [0.4, 2.5]", () => {
    for (const s of sampleNew(100)) {
      for (const b of s.bodies) {
        const arch = BODY_ARCHETYPES[b.bodyType];
        for (const r of RESOURCE_TYPES) {
          if (arch.resourceBase[r] > 0) {
            expect(b.quality[r]).toBeGreaterThanOrEqual(QUALITY_MIN);
            expect(b.quality[r]).toBeLessThanOrEqual(QUALITY_MAX);
          } else {
            expect(b.quality[r]).toBe(0);
          }
        }
      }
    }
  });

  it("per-system availableSpace equals SPACE_PER_SIZE × Σ body.size", () => {
    for (const s of sampleNew(100)) {
      const expected = SUBSTRATE_GEN.SPACE_PER_SIZE * s.bodies.reduce((sum, b) => sum + b.size, 0);
      expect(s.availableSpace).toBeCloseTo(expected, 6);
    }
  });

  it("per-system slotCap equals sumResourceVectors of body slots", () => {
    for (const s of sampleNew(100)) {
      const expected = sumResourceVectors(s.bodies.map((b) => b.slots));
      for (const r of RESOURCE_TYPES) {
        expect(s.slotCap[r]).toBeCloseTo(expected[r], 6);
      }
    }
  });

  it("per-system generalSpace and habitableSpace equal sums of per-body values", () => {
    for (const s of sampleNew(100)) {
      const expectedGeneral = s.bodies.reduce((sum, b) => sum + b.generalSpace, 0);
      const expectedHabitable = s.bodies.reduce((sum, b) => sum + b.habitableSpace, 0);
      expect(s.generalSpace).toBeCloseTo(expectedGeneral, 6);
      expect(s.habitableSpace).toBeCloseTo(expectedHabitable, 6);
    }
  });

  it("all per-system aggregate values are non-negative numbers", () => {
    for (const s of sampleNew(50)) {
      expect(s.availableSpace).toBeGreaterThanOrEqual(0);
      expect(s.generalSpace).toBeGreaterThanOrEqual(0);
      expect(s.habitableSpace).toBeGreaterThanOrEqual(0);
      for (const r of RESOURCE_TYPES) {
        expect(s.slotCap[r]).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
