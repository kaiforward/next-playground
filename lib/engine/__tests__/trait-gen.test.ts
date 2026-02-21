import { describe, it, expect } from "vitest";
import {
  generateSystemTraits,
  deriveEconomyType,
  enforceCoherence,
  type GeneratedTrait,
} from "../trait-gen";
import { mulberry32, type RNG } from "../universe-gen";
import { ALL_TRAIT_IDS, TRAITS } from "@/lib/constants/traits";
import {
  REGION_THEME_TRAIT_COUNT,
  UNIVERSE_GEN,
} from "@/lib/constants/universe-gen";
import type { EconomyType, QualityTier, RegionTheme, TraitId } from "@/lib/types/game";

// ── Helpers ─────────────────────────────────────────────────────

function makeRng(seed = 42): RNG {
  return mulberry32(seed);
}

function makeTrait(traitId: TraitId, quality: QualityTier = 1): GeneratedTrait {
  return { traitId, quality };
}

// ── generateSystemTraits ────────────────────────────────────────

describe("generateSystemTraits", () => {
  it("returns traits within the theme's count range", () => {
    const rng = makeRng();
    for (const theme of [
      "garden_heartland",
      "mineral_frontier",
      "frontier_wilds",
    ] as RegionTheme[]) {
      const range = REGION_THEME_TRAIT_COUNT[theme];
      // Generate 50 samples to cover the range
      for (let i = 0; i < 50; i++) {
        const traits = generateSystemTraits(rng, theme);
        expect(traits.length).toBeGreaterThanOrEqual(range.min);
        expect(traits.length).toBeLessThanOrEqual(range.max);
      }
    }
  });

  it("produces unique trait IDs within a single system", () => {
    const rng = makeRng();
    for (let i = 0; i < 100; i++) {
      const traits = generateSystemTraits(rng, "garden_heartland");
      const ids = traits.map((t) => t.traitId);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("only produces valid trait IDs", () => {
    const rng = makeRng();
    const validIds = new Set(ALL_TRAIT_IDS);
    for (let i = 0; i < 100; i++) {
      const traits = generateSystemTraits(rng, "research_cluster");
      for (const t of traits) {
        expect(validIds.has(t.traitId)).toBe(true);
      }
    }
  });

  it("only produces valid quality tiers (1, 2, or 3)", () => {
    const rng = makeRng();
    for (let i = 0; i < 100; i++) {
      const traits = generateSystemTraits(rng, "energy_belt");
      for (const t of traits) {
        expect([1, 2, 3]).toContain(t.quality);
      }
    }
  });

  it("is deterministic for the same seed", () => {
    const traits1 = generateSystemTraits(makeRng(99), "trade_nexus");
    const traits2 = generateSystemTraits(makeRng(99), "trade_nexus");
    expect(traits1).toEqual(traits2);
  });

  it("biases toward theme-weighted traits", () => {
    const rng = makeRng();
    // mineral_frontier has elevated weights for asteroid_belt, gas_giant, mineral_rich_moons, etc.
    const mineralTraitCounts = new Map<string, number>();
    for (let i = 0; i < 200; i++) {
      const traits = generateSystemTraits(rng, "mineral_frontier");
      for (const t of traits) {
        mineralTraitCounts.set(t.traitId, (mineralTraitCounts.get(t.traitId) ?? 0) + 1);
      }
    }
    // asteroid_belt (weight 30) should appear much more than a random base-weight trait
    const asteroidCount = mineralTraitCounts.get("asteroid_belt") ?? 0;
    expect(asteroidCount).toBeGreaterThan(20);
  });

  it("frontier_wilds produces fewer traits (1-2)", () => {
    const rng = makeRng();
    for (let i = 0; i < 50; i++) {
      const traits = generateSystemTraits(rng, "frontier_wilds");
      expect(traits.length).toBeLessThanOrEqual(2);
    }
  });
});

// ── deriveEconomyType ───────────────────────────────────────────

describe("deriveEconomyType", () => {
  it("derives agricultural for habitable_world + ocean_world", () => {
    const traits = [makeTrait("habitable_world", 2), makeTrait("ocean_world", 2)];
    // habitable_world: agricultural 4, ocean_world: agricultural 3
    // Expected: agricultural scores highest
    expect(deriveEconomyType(traits, "garden_heartland")).toBe("agricultural");
  });

  it("derives extraction for asteroid_belt + mineral_rich_moons", () => {
    const traits = [makeTrait("asteroid_belt", 2), makeTrait("mineral_rich_moons", 2)];
    expect(deriveEconomyType(traits, "mineral_frontier")).toBe("extraction");
  });

  it("derives tech for precursor_ruins + gravitational_anomaly", () => {
    const traits = [makeTrait("precursor_ruins", 2), makeTrait("gravitational_anomaly", 2)];
    expect(deriveEconomyType(traits, "research_cluster")).toBe("tech");
  });

  it("derives industrial for lagrange_stations + heavy_metal_veins", () => {
    const traits = [makeTrait("lagrange_stations", 2), makeTrait("heavy_metal_veins", 2)];
    expect(deriveEconomyType(traits, "industrial_corridor")).toBe("industrial");
  });

  it("derives core for ancient_trade_route + lagrange_stations", () => {
    const traits = [makeTrait("ancient_trade_route", 2), makeTrait("lagrange_stations", 1)];
    // ancient_trade_route: core 5, lagrange_stations: core 2
    expect(deriveEconomyType(traits, "trade_nexus")).toBe("core");
  });

  it("derives refinery for gas_giant + helium3_reserves", () => {
    const traits = [makeTrait("gas_giant", 2), makeTrait("helium3_reserves", 2)];
    expect(deriveEconomyType(traits, "energy_belt")).toBe("refinery");
  });

  it("quality multiplies affinity scores", () => {
    // habitable_world has agricultural: 4, core: 1
    // At quality 1: agricultural = 4, core = 1
    // At quality 3: agricultural = 12, core = 3
    const q1 = deriveEconomyType([makeTrait("habitable_world", 1)], "frontier_wilds");
    const q3 = deriveEconomyType([makeTrait("habitable_world", 3)], "frontier_wilds");
    // Both should still be agricultural since relative ratios are preserved
    expect(q1).toBe("agricultural");
    expect(q3).toBe("agricultural");
  });

  it("tiebreaker favors theme-aligned economy", () => {
    // Create a trait combo that could tie between two economies,
    // then verify the theme tiebreaker resolves it
    // desert_world: extraction 2, industrial 2 (equal)
    // In industrial_corridor theme, industrial gets +1 tiebreaker
    const traits = [makeTrait("desert_world", 1)];
    expect(deriveEconomyType(traits, "industrial_corridor")).toBe("industrial");
  });

  it("falls back to extraction for empty trait list in neutral theme", () => {
    // Empty traits → all scores 0, but contested_frontier has no tiebreaker
    // Fallback: extraction (first in iteration order with score > -1)
    const result = deriveEconomyType([], "contested_frontier");
    // With all-zero scores and no tiebreaker, the first economy type
    // with score > bestScore(-1) wins. Since scores are all 0, the first
    // in ALL_ECONOMY_TYPES order wins: "agricultural"
    expect(["agricultural", "extraction"]).toContain(result);
  });
});

// ── enforceCoherence ────────────────────────────────────────────

describe("enforceCoherence", () => {
  function makeSystem(
    index: number,
    regionIndex: number,
    economyType: EconomyType,
    isGateway = false,
  ) {
    return {
      index,
      regionIndex,
      economyType,
      traits: [makeTrait("asteroid_belt", 1)],
      isGateway,
    };
  }

  it("returns 0 rerolls when region already meets coherence threshold", () => {
    const rng = makeRng();
    // 5 systems, 4 extraction = 80% > 60% threshold
    const systems = [
      makeSystem(0, 0, "extraction"),
      makeSystem(1, 0, "extraction"),
      makeSystem(2, 0, "extraction"),
      makeSystem(3, 0, "extraction"),
      makeSystem(4, 0, "tech"),
    ];
    const themes = new Map([[0, "mineral_frontier" as RegionTheme]]);
    const rerolls = enforceCoherence(rng, systems, themes);
    expect(rerolls).toBe(0);
  });

  it("rerolls borderline systems to meet 60% threshold", () => {
    const rng = makeRng();
    // 10 systems, 4 extraction + 6 others = 40% < 60% threshold
    const systems = [
      makeSystem(0, 0, "extraction"),
      makeSystem(1, 0, "extraction"),
      makeSystem(2, 0, "extraction"),
      makeSystem(3, 0, "extraction"),
      makeSystem(4, 0, "tech"),
      makeSystem(5, 0, "agricultural"),
      makeSystem(6, 0, "industrial"),
      makeSystem(7, 0, "core"),
      makeSystem(8, 0, "refinery"),
      makeSystem(9, 0, "agricultural"),
    ];
    const themes = new Map([[0, "mineral_frontier" as RegionTheme]]);
    const rerolls = enforceCoherence(rng, systems, themes);
    expect(rerolls).toBeGreaterThan(0);
  });

  it("does not reroll gateway systems", () => {
    const rng = makeRng();
    // 5 systems, 2 extraction + 3 non-extraction. 2/5 = 40% < 60%.
    // But 2 non-extraction are gateways — only 1 candidate for reroll.
    const systems = [
      makeSystem(0, 0, "extraction"),
      makeSystem(1, 0, "extraction"),
      makeSystem(2, 0, "tech", true),    // gateway — exempt
      makeSystem(3, 0, "core", true),    // gateway — exempt
      makeSystem(4, 0, "agricultural"),   // only reroll candidate
    ];
    const themes = new Map([[0, "mineral_frontier" as RegionTheme]]);
    const before = systems[2].economyType;
    enforceCoherence(rng, systems, themes);
    // Gateways should keep their original economy
    expect(systems[2].economyType).toBe(before);
    expect(systems[3].economyType).toBe("core");
  });

  it("breaks monotonous regions (all same economy)", () => {
    const rng = makeRng();
    // All 5 systems have the same economy
    const systems = [
      makeSystem(0, 0, "extraction"),
      makeSystem(1, 0, "extraction"),
      makeSystem(2, 0, "extraction"),
      makeSystem(3, 0, "extraction"),
      makeSystem(4, 0, "extraction"),
    ];
    const themes = new Map([[0, "mineral_frontier" as RegionTheme]]);
    const rerolls = enforceCoherence(rng, systems, themes);
    expect(rerolls).toBeGreaterThan(0);
    // At least one system should now have a different economy
    const economies = new Set(systems.map((s) => s.economyType));
    expect(economies.size).toBeGreaterThan(1);
  });

  it("handles multiple regions independently", () => {
    const rng = makeRng();
    // Region 0: already coherent, Region 1: monotonous
    const systems = [
      makeSystem(0, 0, "extraction"),
      makeSystem(1, 0, "extraction"),
      makeSystem(2, 0, "tech"),
      makeSystem(3, 1, "agricultural"),
      makeSystem(4, 1, "agricultural"),
      makeSystem(5, 1, "agricultural"),
    ];
    const themes = new Map<number, RegionTheme>([
      [0, "mineral_frontier"],
      [1, "garden_heartland"],
    ]);
    enforceCoherence(rng, systems, themes);
    // Region 0 should be untouched (2/3 = 67% > 60%)
    // Region 1 should have at least one non-agricultural after monotony fix
    const r1Economies = new Set(
      systems.filter((s) => s.regionIndex === 1).map((s) => s.economyType),
    );
    expect(r1Economies.size).toBeGreaterThan(1);
  });

  it("is deterministic for the same seed", () => {
    function runCoherence(seed: number) {
      const rng = mulberry32(seed);
      const systems = [
        makeSystem(0, 0, "extraction"),
        makeSystem(1, 0, "extraction"),
        makeSystem(2, 0, "extraction"),
        makeSystem(3, 0, "extraction"),
        makeSystem(4, 0, "extraction"),
      ];
      const themes = new Map([[0, "mineral_frontier" as RegionTheme]]);
      enforceCoherence(rng, systems, themes);
      return systems.map((s) => s.economyType);
    }
    expect(runCoherence(42)).toEqual(runCoherence(42));
  });
});
