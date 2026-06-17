/**
 * Trait-derived danger — a pure function, zero DB dependency.
 */

import type { QualityTier, TraitId } from "@/lib/types/game";
import { TRAITS } from "@/lib/constants/traits";
import { getFeatureTraits } from "@/lib/utils/traits";

// ── Output types ────────────────────────────────────────────────

export interface GeneratedTrait {
  traitId: TraitId;
  quality: QualityTier;
}

/**
 * Sum the danger modifiers from a system's traits.
 * Positive values increase danger, negative values reduce it.
 *
 * Only FEATURE-kind traits contribute. The archetype/richness danger traits
 * (volcanic_world, habitable_world, radioactive_deposits) stop contributing here —
 * real body-type danger is wired from SystemBody rows in PR3. See
 * docs/plans/economy-simulation-sp1-pr2-detach-consumers.md ("Design decision").
 */
export function computeTraitDanger(traits: GeneratedTrait[]): number {
  let total = 0;
  for (const { traitId } of getFeatureTraits(traits)) {
    const def = TRAITS[traitId];
    if (def.dangerModifier) {
      total += def.dangerModifier;
    }
  }
  return total;
}
