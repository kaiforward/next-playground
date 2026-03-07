/**
 * Shared market tick entry builder.
 *
 * Both the live economy processor and the simulator need to construct
 * MarketTickEntry objects with the same pipeline:
 *   good constants → government scaling → self-sufficiency → trait bonus
 *   → prosperity → event modifiers
 *
 * This module provides a single function that does all of that,
 * eliminating the duplication that could cause sim/game divergence.
 */

import { GOODS } from "@/lib/constants/goods";
import { getConsumeEquilibrium } from "@/lib/constants/economy";
import { adjustEquilibriumSpread, type GovernmentDefinition } from "@/lib/constants/government";
import { aggregateModifiers, type ModifierRow } from "@/lib/engine/events";
import { buildMarketTickEntry, type MarketTickEntry, type ProsperityParams } from "@/lib/engine/tick";
import type { GeneratedTrait } from "@/lib/engine/trait-gen";
import type { EconomyType } from "@/lib/types/game";

/** Data-source-agnostic input for building a market tick entry. */
export interface MarketTickInput {
  goodId: string;
  supply: number;
  demand: number;
  basePrice: number;
  economyType: EconomyType;
  /** List of good IDs this system produces. */
  produces: string[];
  /** List of good IDs this system consumes. */
  consumes: string[];
  /** Base production rate for this good at this economy type (undefined = not a producer). */
  baseProductionRate?: number;
  /** Base consumption rate for this good at this economy type (undefined = not a consumer). */
  baseConsumptionRate?: number;
  /** Government definition for the region (undefined if no government). */
  govDef?: GovernmentDefinition;
  /** System traits (already validated). */
  traits: GeneratedTrait[];
  /** System prosperity value. */
  prosperity: number;
  /** Active economy modifiers for this system (already filtered). */
  modifiers: ModifierRow[];
  /** Modifier caps from constants. */
  modifierCaps: {
    minTargetMult: number;
    maxTargetMult: number;
    minMultiplier: number;
    maxMultiplier: number;
    minReversionMult: number;
  };
}

/**
 * Build a complete MarketTickEntry from data-source-agnostic inputs.
 *
 * Handles the full pipeline: good constants → government volatility scaling →
 * self-sufficiency → government equilibrium spread → trait bonuses →
 * prosperity multiplier → event modifier aggregation.
 *
 * Used by both the live economy processor and the simulator to ensure
 * identical market tick logic.
 */
export function resolveMarketTickEntry(
  input: MarketTickInput,
  prosperityParams: ProsperityParams,
): MarketTickEntry {
  const goodDef = GOODS[input.goodId];

  // Government: scale volatility
  const baseVolatility = goodDef?.volatility ?? 1;
  const volatility = input.govDef
    ? baseVolatility * input.govDef.volatilityModifier
    : baseVolatility;

  // Self-sufficiency: adjust consume targets per economy type
  let equilibriumProduces = goodDef?.equilibrium.produces;
  let equilibriumConsumes = goodDef
    ? getConsumeEquilibrium(input.economyType, input.goodId, goodDef.equilibrium)
    : undefined;

  // Government: scale equilibrium spread
  if (input.govDef && input.govDef.equilibriumSpreadPct !== 0) {
    if (equilibriumProduces) {
      equilibriumProduces = adjustEquilibriumSpread(equilibriumProduces, input.govDef.equilibriumSpreadPct);
    }
    if (equilibriumConsumes) {
      equilibriumConsumes = adjustEquilibriumSpread(equilibriumConsumes, input.govDef.equilibriumSpreadPct);
    }
  }

  // Build the base entry (handles traits, prosperity, gov consumption boost)
  const entry = buildMarketTickEntry({
    goodId: input.goodId,
    supply: input.supply,
    demand: input.demand,
    basePrice: input.basePrice,
    economyType: input.economyType,
    produces: input.produces,
    consumes: input.consumes,
    volatility,
    equilibriumProduces,
    equilibriumConsumes,
    baseProductionRate: input.baseProductionRate,
    baseConsumptionRate: input.baseConsumptionRate,
    govConsumptionBoost: input.govDef?.consumptionBoosts[input.goodId] ?? 0,
    traits: input.traits,
    prosperity: input.prosperity,
  }, prosperityParams);

  // Apply event modifier aggregation
  if (input.modifiers.length === 0) return entry;

  const agg = aggregateModifiers(input.modifiers, input.goodId, input.modifierCaps);
  return {
    ...entry,
    supplyTargetMult: agg.supplyTargetMult,
    demandTargetMult: agg.demandTargetMult,
    productionMult: agg.productionMult,
    consumptionMult: agg.consumptionMult,
    reversionMult: agg.reversionMult,
  };
}
