import type { SystemTraitInfo, QualityTier, TraitCategory } from "@/lib/types/game";
import { TRAITS, QUALITY_TIERS } from "@/lib/constants/traits";

/** Enriched trait with pre-resolved display fields. */
export interface EnrichedTrait {
  traitId: string;
  quality: QualityTier;
  name: string;
  category: TraitCategory;
  qualityLabel: string;
  description: string;
  negative: boolean;
}

/** Resolve display fields from raw trait info. */
export function enrichTraits(traits: SystemTraitInfo[]): EnrichedTrait[] {
  return traits.map((t) => {
    const def = TRAITS[t.traitId];
    const tier = QUALITY_TIERS[t.quality];
    return {
      traitId: t.traitId,
      quality: t.quality,
      name: def.name,
      category: def.category,
      qualityLabel: tier.label,
      description: def.descriptions[t.quality],
      negative: def.negative ?? false,
    };
  });
}
