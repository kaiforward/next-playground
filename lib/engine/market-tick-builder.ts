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
/** Result of resolving a market tick: the stock-sim entry plus the pricing anchor. */
export interface ResolvedMarketTick {
  /** Input to the stock simulation (production/consumption rates, volatility, …). */
  entry: MarketTickEntry;
  /**
   * Pricing-anchor multiplier from active `anchor_shift` modifiers (1 = none).
   * Computed here so the caller need not re-aggregate the same modifiers.
   */
  anchorMult: number;
}

/** Data-source-agnostic input for building a market tick entry. */
export interface MarketTickInput {
  goodId: string;
  stock: number;
  /** Base production rate for this good (undefined = not a producer). */
  baseProductionRate?: number;
  /** Base consumption rate for this good (undefined = not a consumer). */
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
 * Resolve a market tick from data-source-agnostic inputs. Used by both the live
 * economy processor and the simulator so the tick logic is identical. Returns
 * the stock-sim `entry` and the pricing `anchorMult` (derived from the same
 * modifier aggregation) so the caller never re-aggregates.
 */
export function resolveMarketTickEntry(
  input: MarketTickInput,
  prosperityParams: ProsperityParams,
): ResolvedMarketTick {
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
      volatility,
      baseProductionRate: input.baseProductionRate,
      baseConsumptionRate: input.baseConsumptionRate,
      govConsumptionBoost: input.govDef?.consumptionBoosts[input.goodId] ?? 0,
      traits: input.traits,
      prosperity: input.prosperity,
    },
    prosperityParams,
  );

  if (input.modifiers.length === 0) return { entry, anchorMult: 1 };

  // Only production/consumption rate multipliers affect the stock tick.
  // supply_target/demand_target modifiers have been converted to anchor_shift,
  // which affects PRICING via the stored anchorMult (returned here for the
  // caller to persist), not the stock delta. Events also shape the economy
  // via stock shocks (applied separately).
  const agg = aggregateModifiers(input.modifiers, input.goodId, input.modifierCaps);
  return {
    entry: {
      ...entry,
      productionMult: agg.productionMult,
      consumptionMult: agg.consumptionMult,
    },
    anchorMult: agg.anchorMult,
  };
}
