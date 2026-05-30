/**
 * Shared market tick entry builder.
 *
 * Both the live economy processor and the simulator build MarketTickEntry
 * objects through the same pipeline: good constants → government volatility
 * scaling → trait bonus → prosperity → event production/consumption modifiers.
 * (The legacy equilibrium-spread / self-sufficiency steps are gone — there is
 * no equilibrium target in the stock model.)
 */

import { GOODS } from "@/lib/constants/goods";
import { type GovernmentDefinition } from "@/lib/constants/government";
import { aggregateModifiers, type ModifierRow, type ModifierCaps } from "@/lib/engine/events";
import { buildMarketTickEntry, type MarketTickEntry, type ProsperityParams } from "@/lib/engine/tick";
import type { GeneratedTrait } from "@/lib/engine/trait-gen";
import type { EconomyType } from "@/lib/types/game";

/** Data-source-agnostic input for building a market tick entry. */
export interface MarketTickInput {
  goodId: string;
  stock: number;
  economyType: EconomyType;
  /** List of good IDs this system produces. */
  produces: string[];
  /** List of good IDs this system consumes. */
  consumes: string[];
  /** Base production rate for this good at this economy type (undefined = not a producer). */
  baseProductionRate?: number;
  /** Base consumption rate for this good at this economy type (undefined = not a consumer). */
  baseConsumptionRate?: number;
  /** Government definition for the system's owning faction (undefined if none). */
  govDef?: GovernmentDefinition;
  /** System traits (already validated). */
  traits: GeneratedTrait[];
  /** System prosperity value. */
  prosperity: number;
  /** Active economy modifiers for this system (already filtered). */
  modifiers: ModifierRow[];
  /** Modifier caps from constants. */
  modifierCaps: ModifierCaps;
}

/**
 * Build a complete MarketTickEntry from data-source-agnostic inputs. Used by
 * both the live economy processor and the simulator so the tick logic is
 * identical.
 */
export function resolveMarketTickEntry(
  input: MarketTickInput,
  prosperityParams: ProsperityParams,
): MarketTickEntry {
  const goodDef = GOODS[input.goodId];

  // Government scales volatility (amplifies/dampens noise).
  const baseVolatility = goodDef?.volatility ?? 1;
  const volatility = input.govDef
    ? baseVolatility * input.govDef.volatilityModifier
    : baseVolatility;

  const entry = buildMarketTickEntry(
    {
      goodId: input.goodId,
      stock: input.stock,
      economyType: input.economyType,
      produces: input.produces,
      consumes: input.consumes,
      volatility,
      baseProductionRate: input.baseProductionRate,
      baseConsumptionRate: input.baseConsumptionRate,
      govConsumptionBoost: input.govDef?.consumptionBoosts[input.goodId] ?? 0,
      traits: input.traits,
      prosperity: input.prosperity,
    },
    prosperityParams,
  );

  if (input.modifiers.length === 0) return entry;

  // Only production/consumption rate multipliers affect the stock tick.
  // supply_target/demand_target modifiers have been converted to anchor_shift,
  // which affects PRICING via the stored anchorMult (computed by the economy
  // processor each tick), not the stock delta. Events also shape the economy
  // via stock shocks (applied separately).
  const agg = aggregateModifiers(input.modifiers, input.goodId, input.modifierCaps);
  return {
    ...entry,
    productionMult: agg.productionMult,
    consumptionMult: agg.consumptionMult,
  };
}
