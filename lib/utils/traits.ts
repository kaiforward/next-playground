import type { SystemTraitInfo, TraitId, QualityTier, TraitCategory } from "@/lib/types/game";
import { TRAITS, QUALITY_TIERS } from "@/lib/constants/traits";
import { TRAIT_MIGRATION } from "@/lib/constants/trait-migration";

/** Enriched trait with pre-resolved display fields. */
export interface EnrichedTrait {
  traitId: TraitId;
  quality: QualityTier;
  name: string;
  category: TraitCategory;
  qualityLabel: string;
  description: string;
  negative: boolean;
}

// ── Feature classification ───────────────────────────────────────
//
// In the economy-simulation substrate rebuild (SP1) the legacy trait catalog
// splits three ways (see TRAIT_MIGRATION): world/body-type traits become body
// *archetypes*, abundant-resource traits become richness *modifiers*, and the
// narrative survivors stay as *features*. These helpers let danger/mission
// consumers read only the feature subset ahead of PR3's catalog prune.

/** True when a trait survives the substrate rebuild as a narrative feature. */
export function isFeatureTrait(traitId: TraitId): boolean {
  return TRAIT_MIGRATION[traitId].kind === "feature";
}

/**
 * Keep only narrative-feature traits, dropping the archetype/richness traits
 * that PR3 reclassifies onto body data. Order-preserving. Generic over the
 * trait shape so it works for both `SystemTraitInfo` and `GeneratedTrait`.
 */
export function getFeatureTraits<T extends { traitId: TraitId }>(traits: T[]): T[] {
  return traits.filter((t) => isFeatureTrait(t.traitId));
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
