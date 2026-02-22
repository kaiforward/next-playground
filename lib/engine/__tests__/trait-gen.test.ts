import { describe, it, expect } from "vitest";
import {
  generateSystemTraits,
  deriveEconomyType,
  computeTraitProductionBonus,
  type GeneratedTrait,
} from "../trait-gen";
import { mulberry32, type RNG } from "../universe-gen";
import { ALL_TRAIT_IDS, TRAITS } from "@/lib/constants/traits";
import { TRAIT_COUNT } from "@/lib/constants/universe-gen";
import type { QualityTier, TraitId } from "@/lib/types/game";

// ── Helpers ─────────────────────────────────────────────────────

function makeRng(seed = 42): RNG {
  return mulberry32(seed);
}

function makeTrait(traitId: TraitId, quality: QualityTier = 1): GeneratedTrait {
  return { traitId, quality };
}

// ── generateSystemTraits ────────────────────────────────────────

describe("generateSystemTraits", () => {
  it("returns traits within the uniform count range", () => {
    const rng = makeRng();
    // Generate 50 samples to cover the range
    for (let i = 0; i < 50; i++) {
      const traits = generateSystemTraits(rng);
      expect(traits.length).toBeGreaterThanOrEqual(TRAIT_COUNT.min);
      expect(traits.length).toBeLessThanOrEqual(TRAIT_COUNT.max);
    }
  });

  it("produces unique trait IDs within a single system", () => {
    const rng = makeRng();
    for (let i = 0; i < 100; i++) {
      const traits = generateSystemTraits(rng);
      const ids = traits.map((t) => t.traitId);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("only produces valid trait IDs", () => {
    const rng = makeRng();
    const validIds = new Set(ALL_TRAIT_IDS);
    for (let i = 0; i < 100; i++) {
      const traits = generateSystemTraits(rng);
      for (const t of traits) {
        expect(validIds.has(t.traitId)).toBe(true);
      }
    }
  });

  it("only produces valid quality tiers (1, 2, or 3)", () => {
    const rng = makeRng();
    for (let i = 0; i < 100; i++) {
      const traits = generateSystemTraits(rng);
      for (const t of traits) {
        expect([1, 2, 3]).toContain(t.quality);
      }
    }
  });

  it("is deterministic for the same seed", () => {
    const traits1 = generateSystemTraits(makeRng(99));
    const traits2 = generateSystemTraits(makeRng(99));
    expect(traits1).toEqual(traits2);
  });

  it("draws traits uniformly — no bias", () => {
    const rng = makeRng();
    // Run many samples — trait frequency should be roughly uniform
    const counts = new Map<string, number>();
    for (let i = 0; i < 1000; i++) {
      const traits = generateSystemTraits(rng);
      for (const t of traits) {
        counts.set(t.traitId, (counts.get(t.traitId) ?? 0) + 1);
      }
    }
    // No single trait should dominate (>10% of all rolls)
    const total = [...counts.values()].reduce((s, v) => s + v, 0);
    for (const [, count] of counts) {
      expect(count / total).toBeLessThan(0.1);
    }
  });

  it("first trait always has at least one strong (value 2) affinity", () => {
    const rng = makeRng();
    for (let i = 0; i < 200; i++) {
      const traits = generateSystemTraits(rng);
      const firstTrait = traits[0];
      const def = TRAITS[firstTrait.traitId];
      const hasStrongAffinity = Object.values(def.economyAffinity).some((v) => v === 2);
      expect(hasStrongAffinity).toBe(true);
    }
  });
});

// ── computeTraitProductionBonus ──────────────────────────────────

describe("computeTraitProductionBonus", () => {
  it("returns 0 for traits with no matching production goods", () => {
    // dark_nebula has no productionGoods
    const traits = [makeTrait("dark_nebula", 2)];
    expect(computeTraitProductionBonus(traits, "food")).toBe(0);
  });

  it("returns quality modifier for matching production good", () => {
    // habitable_world produces "food" — quality 2 modifier is 0.40
    const traits = [makeTrait("habitable_world", 2)];
    expect(computeTraitProductionBonus(traits, "food")).toBeCloseTo(0.40);
  });

  it("stacks modifiers from multiple matching traits", () => {
    // habitable_world (q2: 0.40) + ocean_world (q1: 0.15) both produce "food"
    const traits = [makeTrait("habitable_world", 2), makeTrait("ocean_world", 1)];
    expect(computeTraitProductionBonus(traits, "food")).toBeCloseTo(0.55);
  });

  it("only counts traits that produce the specific good", () => {
    // habitable_world produces food, asteroid_belt produces ore — neither produces "tech_components"
    const traits = [makeTrait("habitable_world", 3), makeTrait("asteroid_belt", 3)];
    expect(computeTraitProductionBonus(traits, "tech_components")).toBe(0);
  });

  it("returns 0 for empty trait list", () => {
    expect(computeTraitProductionBonus([], "food")).toBe(0);
  });
});

// ── deriveEconomyType ───────────────────────────────────────────

describe("deriveEconomyType", () => {
  it("derives agricultural for habitable_world + ocean_world", () => {
    const rng = makeRng();
    const traits = [makeTrait("habitable_world", 2), makeTrait("ocean_world", 2)];
    // habitable_world: agricultural strong (2), ocean_world: agricultural strong (2)
    expect(deriveEconomyType(traits, rng)).toBe("agricultural");
  });

  it("derives extraction for asteroid_belt + superdense_core", () => {
    const rng = makeRng();
    const traits = [makeTrait("asteroid_belt", 2), makeTrait("superdense_core", 2)];
    expect(deriveEconomyType(traits, rng)).toBe("extraction");
  });

  it("derives tech for precursor_ruins + gravitational_anomaly", () => {
    const rng = makeRng();
    const traits = [makeTrait("precursor_ruins", 2), makeTrait("gravitational_anomaly", 2)];
    expect(deriveEconomyType(traits, rng)).toBe("tech");
  });

  it("derives industrial for lagrange_stations + heavy_metal_veins", () => {
    const rng = makeRng();
    const traits = [makeTrait("lagrange_stations", 2), makeTrait("heavy_metal_veins", 2)];
    expect(deriveEconomyType(traits, rng)).toBe("industrial");
  });

  it("derives core for ancient_trade_route + deep_space_beacon", () => {
    const rng = makeRng();
    const traits = [makeTrait("ancient_trade_route", 2), makeTrait("deep_space_beacon", 1)];
    // ancient_trade_route: core strong (2) → score 2
    // deep_space_beacon: core strong (2) → score 1
    // core total = 3, industrial minor (1) from ancient_trade_route not counted
    expect(deriveEconomyType(traits, rng)).toBe("core");
  });

  it("derives refinery for binary_star + helium3_reserves", () => {
    const rng = makeRng();
    const traits = [makeTrait("binary_star", 2), makeTrait("helium3_reserves", 2)];
    expect(deriveEconomyType(traits, rng)).toBe("refinery");
  });

  it("ignores minor affinities for derivation", () => {
    const rng = makeRng();
    // mineral_rich_moons has extraction: 1, industrial: 1 — both minor
    // No strong affinities, so should fallback
    const traits = [makeTrait("mineral_rich_moons", 3)];
    // Fallback to extraction for zero strong-affinity scores
    expect(deriveEconomyType(traits, rng)).toBe("extraction");
  });

  it("quality multiplies strong affinity scores", () => {
    const rng = makeRng();
    // habitable_world has agricultural: 2 (strong), core: 2 (strong)
    // At quality 1: agri = 1, core = 1 — tie, resolved by RNG
    // At quality 3: agri = 3, core = 3 — still a tie
    // Both qualities should produce one of the two strong economies
    const q1 = deriveEconomyType([makeTrait("habitable_world", 1)], makeRng(1));
    const q3 = deriveEconomyType([makeTrait("habitable_world", 3)], makeRng(1));
    expect(["agricultural", "core"]).toContain(q1);
    expect(["agricultural", "core"]).toContain(q3);
  });

  it("breaks ties via seeded random", () => {
    // habitable_world has agricultural: 2, core: 2 — exact tie
    // Different seeds should produce different outcomes (probabilistically)
    const results = new Set<string>();
    for (let seed = 0; seed < 20; seed++) {
      results.add(deriveEconomyType([makeTrait("habitable_world", 1)], makeRng(seed)));
    }
    // Should see both agricultural and core across seeds
    expect(results.size).toBeGreaterThan(1);
  });

  it("falls back to extraction for empty trait list", () => {
    const rng = makeRng();
    expect(deriveEconomyType([], rng)).toBe("extraction");
  });
});
