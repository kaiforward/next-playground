/**
 * Trait generation and economy derivation — pure functions, zero DB dependency.
 * Deterministic given a seeded RNG.
 */

import type { EconomyType, QualityTier, TraitId } from "@/lib/types/game";
import { TRAITS, ALL_TRAIT_IDS, QUALITY_TIERS } from "@/lib/constants/traits";
import { TRAIT_COUNT } from "@/lib/constants/universe-gen";
import type { RNG } from "./universe-gen";
import { weightedPick, randInt } from "./universe-gen";

// ── Output types ────────────────────────────────────────────────

export interface GeneratedTrait {
  traitId: TraitId;
  quality: QualityTier;
}

// ── Trait rolling ───────────────────────────────────────────────

/** Trait IDs that have at least one strong (value 2) economy affinity. */
const STRONG_AFFINITY_TRAIT_IDS: readonly TraitId[] = ALL_TRAIT_IDS.filter(
  (id) => Object.values(TRAITS[id].economyAffinity).some((v) => v === 2),
);

/**
 * Roll traits for a single system. Trait count is uniform 2-4.
 * Trait selection is uniformly random from the full 42-trait pool.
 *
 * The first trait is guaranteed to have at least one strong (value 2) economy
 * affinity, ensuring every system has a clear economy signal.
 */
export function generateSystemTraits(
  rng: RNG,
): GeneratedTrait[] {
  const traitCount = randInt(rng, TRAIT_COUNT.min, TRAIT_COUNT.max);

  // Equal weight for all traits — no bias
  const weights: Record<string, number> = {};
  for (const traitId of ALL_TRAIT_IDS) {
    weights[traitId] = 1;
  }

  const traits: GeneratedTrait[] = [];

  // FIRST TRAIT: guaranteed strong-affinity roll (equal weight among strong pool)
  const strongWeights: Record<string, number> = {};
  for (const traitId of STRONG_AFFINITY_TRAIT_IDS) {
    strongWeights[traitId] = 1;
  }
  const firstTraitId = weightedPick(rng, strongWeights) as TraitId;
  delete weights[firstTraitId];
  const firstQuality = weightedPick(rng, {
    "1": QUALITY_TIERS[1].rarity,
    "2": QUALITY_TIERS[2].rarity,
    "3": QUALITY_TIERS[3].rarity,
  });
  traits.push({ traitId: firstTraitId, quality: Number(firstQuality) as QualityTier });

  // REMAINING TRAITS: uniformly random from full pool
  for (let i = 1; i < traitCount; i++) {
    const traitId = weightedPick(rng, weights) as TraitId;
    delete weights[traitId];

    const quality = weightedPick(rng, {
      "1": QUALITY_TIERS[1].rarity,
      "2": QUALITY_TIERS[2].rarity,
      "3": QUALITY_TIERS[3].rarity,
    });

    traits.push({ traitId, quality: Number(quality) as QualityTier });
  }

  return traits;
}

// ── Production bonus ────────────────────────────────────────────

/**
 * Compute the production bonus from a system's traits for a specific good.
 * Returns a multiplier offset: effectiveRate = baseRate × (1 + bonus).
 */
export function computeTraitProductionBonus(
  traits: GeneratedTrait[],
  goodId: string,
): number {
  let bonus = 0;
  for (const { traitId, quality } of traits) {
    const def = TRAITS[traitId];
    if (def.productionGoods.includes(goodId)) {
      bonus += QUALITY_TIERS[quality].modifier;
    }
  }
  return bonus;
}

// ── Economy derivation ──────────────────────────────────────────

const ALL_ECONOMY_TYPES: EconomyType[] = [
  "agricultural", "extraction", "refinery", "industrial", "tech", "core",
];

/**
 * Derive economy type from a system's traits via strong-affinity-only scoring.
 *
 * Formula: score(econ) = sum of quality for traits with affinity === 2 for that econ
 * Minor affinities (value 1) are ignored for derivation.
 * Tiebreaker: seeded random selection among tied economy types.
 * Fallback: extraction (baseline "just scraping by" economy)
 */
export function deriveEconomyType(
  traits: GeneratedTrait[],
  rng: RNG,
): EconomyType {
  const scores: Record<EconomyType, number> = {
    agricultural: 0,
    extraction: 0,
    refinery: 0,
    industrial: 0,
    tech: 0,
    core: 0,
  };

  // Score each economy type from strong affinities only
  for (const { traitId, quality } of traits) {
    const def = TRAITS[traitId];
    for (const [econ, affinity] of Object.entries(def.economyAffinity)) {
      if (affinity === 2) {
        scores[econ as EconomyType] += quality;
      }
    }
  }

  // Find the highest score
  let bestScore = -1;
  for (const econ of ALL_ECONOMY_TYPES) {
    if (scores[econ] > bestScore) {
      bestScore = scores[econ];
    }
  }

  // Fallback for zero-affinity systems (should not occur with guaranteed strong roll)
  if (bestScore <= 0) return "extraction";

  // Collect all tied winners
  const winners = ALL_ECONOMY_TYPES.filter((e) => scores[e] === bestScore);

  // Single winner or seeded random tiebreaker
  if (winners.length === 1) return winners[0];
  return winners[Math.floor(rng() * winners.length)];
}
