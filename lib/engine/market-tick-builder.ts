/**
 * Shared market tick entry builder.
 *
 * The economy processor builds its MarketTickEntry objects through this
 * pipeline: good constants → event production/consumption modifiers.
 * (The legacy equilibrium-spread / self-sufficiency steps are gone — there is
 * no equilibrium target in the stock model.)
 */

import { GOODS } from "@/lib/constants/goods";
import { aggregateModifiers, type ModifierRow, type ModifierCaps } from "@/lib/engine/events";
import { buildMarketTickEntry, type MarketTickEntry } from "@/lib/engine/tick";
import { marketBand } from "@/lib/engine/market-pricing";
/** Result of resolving a market tick: the stock-sim entry plus the pricing anchor. */
export interface ResolvedMarketTick {
  /** Input to the stock simulation (production/consumption rates, …). */
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
  /** Stored local demand rate (civilian demand — per-capita baseline + skilled baskets — floored at seed). */
  demandRate: number;
  /** THE USE FIGURE — the brake knee's warehousing denominator (see MarketTickEntry.honestUseRate). */
  honestUseRate: number;
  /** Reference-cycle production rate: pre-catchUp, pre-suppress, pre-event — the knee's output denominator. */
  capacityProduction: number;
  /** Built infrastructure storage capacity from StationMarket.storageCapacity. */
  storageCapacity: number;
  /** Base production rate for this good (undefined = not a producer). */
  baseProductionRate?: number;
  /** Base consumption rate for this good (undefined = not a consumer). */
  baseConsumptionRate?: number;
  /** Active economy modifiers for this system (already filtered). */
  modifiers: ModifierRow[];
  /** Modifier caps from constants. */
  modifierCaps: ModifierCaps;
  /** Production-only suppression multiplier (1 = none). Strike state from unrest. */
  productionSuppress?: number;
}

/**
 * Resolve a market tick from data-source-agnostic inputs. Returns the
 * stock-sim `entry` and the pricing `anchorMult` (derived from the same
 * modifier aggregation) so the caller never re-aggregates.
 */
export function resolveMarketTickEntry(input: MarketTickInput): ResolvedMarketTick {
  const goodDef = GOODS[input.goodId];

  // Aggregate modifiers first so anchorMult is available before band computation.
  // The band must track event anchor shifts: a bumper-harvest doubling the anchor
  // should also widen the stock band so the ceiling doesn't clip the raised target.
  let anchorMult = 1;
  let productionMult: number | undefined;
  let consumptionMult: number | undefined;

  if (input.modifiers.length > 0) {
    // Only production/consumption rate multipliers affect the stock tick.
    // supply_target/demand_target modifiers have been converted to anchor_shift,
    // which affects PRICING via the stored anchorMult (returned here for the
    // caller to persist), not the stock delta. Events also shape the economy
    // via stock shocks (applied separately).
    const agg = aggregateModifiers(input.modifiers, input.goodId, input.modifierCaps);
    anchorMult = agg.anchorMult;
    productionMult = agg.productionMult;
    consumptionMult = agg.consumptionMult;
  }

  // Per-market band: anchor shifts fold into targetStock so the band tracks
  // events. Fallback price multiples when goodDef is undefined keep the band finite.
  const band = marketBand({
    demandRate: input.demandRate,
    storageCapacity: input.storageCapacity,
    priceFloor: goodDef?.priceFloor ?? 0.5,
    priceCeiling: goodDef?.priceCeiling ?? 2.0,
    anchorMult,
  });

  const entry = buildMarketTickEntry({
    goodId: input.goodId,
    stock: input.stock,
    honestUseRate: input.honestUseRate,
    capacityProduction: input.capacityProduction,
    anchorMult,
    storageCapacity: input.storageCapacity,
    demandRate: input.demandRate,
    maxStock: band.maxStock,
    baseProductionRate: input.baseProductionRate,
    baseConsumptionRate: input.baseConsumptionRate,
    productionSuppress: input.productionSuppress,
  });

  if (productionMult === undefined && consumptionMult === undefined) {
    return { entry, anchorMult };
  }

  return {
    entry: {
      ...entry,
      ...(productionMult !== undefined ? { productionMult } : {}),
      ...(consumptionMult !== undefined ? { consumptionMult } : {}),
    },
    anchorMult,
  };
}
