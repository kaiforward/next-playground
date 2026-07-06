/**
 * Trait-derived danger — a pure function, zero DB dependency.
 */

import type { QualityTier, TraitId } from "@/lib/types/game";
import { TRAITS } from "@/lib/constants/traits";

// ── Output types ────────────────────────────────────────────────

export interface GeneratedTrait {
  traitId: TraitId;
  quality: QualityTier;
}

/**
 * Sum the danger modifiers from a system's feature traits. Positive values
 * increase danger, negative values reduce it. Body-type environmental danger is
 * summed separately as `bodyDanger`; the overview danger readout adds the two
 * to the government baseline.
 */
export function computeTraitDanger(traits: GeneratedTrait[]): number {
  let total = 0;
  for (const { traitId } of traits) {
    const def = TRAITS[traitId];
    if (def.dangerModifier) {
      total += def.dangerModifier;
    }
  }
  return total;
}
