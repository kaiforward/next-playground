/**
 * Trait generation and economy derivation — pure functions, zero DB dependency.
 * Deterministic given a seeded RNG.
 */

import type { EconomyType, QualityTier, RegionTheme, TraitId } from "@/lib/types/game";
import { TRAITS, ALL_TRAIT_IDS, QUALITY_TIERS } from "@/lib/constants/traits";
import {
  REGION_THEME_TRAIT_WEIGHTS,
  REGION_THEME_TRAIT_COUNT,
  THEME_ECONOMY_TIEBREAKER,
  UNIVERSE_GEN,
} from "@/lib/constants/universe-gen";
import type { RNG } from "./universe-gen";
import { weightedPick, randInt } from "./universe-gen";

// ── Output types ────────────────────────────────────────────────

export interface GeneratedTrait {
  traitId: TraitId;
  quality: QualityTier;
}

// ── Trait rolling ───────────────────────────────────────────────

/**
 * Roll traits for a single system based on its region theme.
 * Returns 1-4 unique traits with quality tiers.
 */
export function generateSystemTraits(
  rng: RNG,
  theme: RegionTheme,
): GeneratedTrait[] {
  const countRange = REGION_THEME_TRAIT_COUNT[theme];
  const traitCount = randInt(rng, countRange.min, countRange.max);

  // Build weight table: base weight for all traits, overlay theme-specific weights
  const themeWeights = REGION_THEME_TRAIT_WEIGHTS[theme];
  const baseWeight = theme === "contested_frontier"
    ? 8 // higher base for contested frontier = more variety
    : UNIVERSE_GEN.BASE_TRAIT_WEIGHT;

  const weights: Record<string, number> = {};
  for (const traitId of ALL_TRAIT_IDS) {
    weights[traitId] = themeWeights[traitId] ?? baseWeight;
  }

  const traits: GeneratedTrait[] = [];
  for (let i = 0; i < traitCount; i++) {
    const traitId = weightedPick(rng, weights) as TraitId;

    // Remove picked trait so no duplicates
    delete weights[traitId];

    // Roll quality tier
    const quality = weightedPick(rng, {
      "1": QUALITY_TIERS[1].rarity,
      "2": QUALITY_TIERS[2].rarity,
      "3": QUALITY_TIERS[3].rarity,
    });

    traits.push({ traitId, quality: Number(quality) as QualityTier });
  }

  return traits;
}

// ── Economy derivation ──────────────────────────────────────────

const ALL_ECONOMY_TYPES: EconomyType[] = [
  "agricultural", "extraction", "refinery", "industrial", "tech", "core",
];

/**
 * Derive economy type from a system's traits via affinity scoring.
 *
 * Formula: score(econ) = sum of (traitAffinity[econ] × quality) for all traits
 * Tiebreaker: region theme preference (+1 bonus)
 * Fallback: extraction (baseline "just scraping by" economy)
 */
export function deriveEconomyType(
  traits: GeneratedTrait[],
  theme: RegionTheme,
): EconomyType {
  const scores: Record<EconomyType, number> = {
    agricultural: 0,
    extraction: 0,
    refinery: 0,
    industrial: 0,
    tech: 0,
    core: 0,
  };

  // Score each economy type from trait affinities
  for (const { traitId, quality } of traits) {
    const def = TRAITS[traitId];
    for (const [econ, affinity] of Object.entries(def.economyAffinity)) {
      scores[econ as EconomyType] += affinity * quality;
    }
  }

  // Apply tiebreaker bonus from region theme
  const tiebreaker = THEME_ECONOMY_TIEBREAKER[theme];
  for (const [econ, bonus] of Object.entries(tiebreaker)) {
    scores[econ as EconomyType] += bonus;
  }

  // Find winner (highest score)
  let best: EconomyType = "extraction"; // fallback for zero-affinity systems
  let bestScore = -1;
  for (const econ of ALL_ECONOMY_TYPES) {
    if (scores[econ] > bestScore) {
      bestScore = scores[econ];
      best = econ;
    }
  }

  return best;
}

// ── Coherence enforcement ───────────────────────────────────────

interface SystemForCoherence {
  index: number;
  regionIndex: number;
  economyType: EconomyType;
  traits: GeneratedTrait[];
  isGateway: boolean;
}

/**
 * Compute the affinity score gap between the top two economy types for a system.
 * Smaller gap = more borderline = better candidate for re-rolling.
 */
function affinityGap(traits: GeneratedTrait[]): number {
  const scores: number[] = ALL_ECONOMY_TYPES.map((econ) => {
    let score = 0;
    for (const { traitId, quality } of traits) {
      const def = TRAITS[traitId];
      score += (def.economyAffinity[econ] ?? 0) * quality;
    }
    return score;
  });

  scores.sort((a, b) => b - a);
  return (scores[0] ?? 0) - (scores[1] ?? 0);
}

/**
 * Enforce region coherence guarantees:
 * 1. At least 60% of systems share the dominant economy type
 * 2. No region is monotonous (all same economy)
 * 3. Gateway systems are exempt from re-rolling
 *
 * Re-rolls traits for borderline systems (smallest affinity gap) to nudge
 * them toward the dominant economy. Returns the number of systems re-rolled.
 */
export function enforceCoherence(
  rng: RNG,
  systems: SystemForCoherence[],
  regionThemes: Map<number, RegionTheme>,
): number {
  let totalRerolls = 0;

  // Group systems by region
  const byRegion = new Map<number, SystemForCoherence[]>();
  for (const sys of systems) {
    if (!byRegion.has(sys.regionIndex)) {
      byRegion.set(sys.regionIndex, []);
    }
    byRegion.get(sys.regionIndex)!.push(sys);
  }

  for (const [regionIndex, regionSystems] of byRegion) {
    const theme = regionThemes.get(regionIndex);
    if (!theme) continue;

    // Count economy types
    const counts = new Map<EconomyType, number>();
    for (const sys of regionSystems) {
      counts.set(sys.economyType, (counts.get(sys.economyType) ?? 0) + 1);
    }

    // Find dominant economy
    let dominant: EconomyType = "extraction";
    let dominantCount = 0;
    for (const [econ, count] of counts) {
      if (count > dominantCount) {
        dominant = econ;
        dominantCount = count;
      }
    }

    const threshold = Math.ceil(regionSystems.length * UNIVERSE_GEN.COHERENCE_THRESHOLD);

    // Rule 1: Ensure 60% agreement
    if (dominantCount < threshold) {
      // Find non-dominant, non-gateway systems sorted by smallest affinity gap (most borderline)
      const candidates = regionSystems
        .filter((s) => s.economyType !== dominant && !s.isGateway)
        .map((s) => ({ sys: s, gap: affinityGap(s.traits) }))
        .sort((a, b) => a.gap - b.gap);

      const needed = threshold - dominantCount;
      for (let i = 0; i < needed && i < candidates.length; i++) {
        const sys = candidates[i].sys;
        // Re-roll traits
        sys.traits = generateSystemTraits(rng, theme);
        sys.economyType = deriveEconomyType(sys.traits, theme);

        // If still not dominant, force one more attempt with a fresh roll
        if (sys.economyType !== dominant) {
          sys.traits = generateSystemTraits(rng, theme);
          sys.economyType = deriveEconomyType(sys.traits, theme);
        }

        totalRerolls++;
      }
    }

    // Rule 2: No monotonous regions (all same economy)
    // Re-count after potential re-rolls
    const updatedCounts = new Map<EconomyType, number>();
    for (const sys of regionSystems) {
      updatedCounts.set(sys.economyType, (updatedCounts.get(sys.economyType) ?? 0) + 1);
    }

    if (updatedCounts.size === 1) {
      // All systems have the same economy — force one non-gateway system to secondary
      const nonGateway = regionSystems.filter((s) => !s.isGateway);
      if (nonGateway.length > 0) {
        // Pick system with strongest secondary affinity (re-roll until different)
        const target = nonGateway[0];
        const originalEconomy = target.economyType;
        let attempts = 0;
        while (target.economyType === originalEconomy && attempts < 10) {
          target.traits = generateSystemTraits(rng, theme);
          target.economyType = deriveEconomyType(target.traits, theme);
          attempts++;
        }
        totalRerolls++;
      }
    }
  }

  return totalRerolls;
}
