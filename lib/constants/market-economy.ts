/**
 * Constants for the stock-based market economy. See
 * docs/active/gameplay/economy.md.
 */

import { ECONOMY_CONSTANTS } from "@/lib/constants/economy";
import { GOODS } from "@/lib/constants/goods";
import { physicalRates } from "@/lib/engine/physical-economy";
import type { GovernmentDefinition } from "@/lib/constants/government";
import type { ResourceVector } from "@/lib/types/game";

/** Price-curve elasticity. k=1 reproduces the legacy demand/supply hyperbola. */
export const DEFAULT_ELASTICITY = 1;

/** Default bid-ask half-spread: buy = mid*(1+s), sell = mid*(1-s). */
export const DEFAULT_SPREAD = 0.05;

/**
 * Days of cover (stock ÷ local demand rate) at which a good's mid price equals
 * its basePrice. The single global reference that replaces the per-good anchor
 * table — per-good market depth now emerges from per-good demand rates.
 * First-draft; Part 3b calibrates this via `npm run simulate`.
 */
export const TARGET_COVER = 50;

/**
 * Floor on the days-of-supply denominator so a near-empty system yields a finite
 * cover instead of a divide-by-zero / zero reference. First-draft; calibrated in 3b.
 */
export const MIN_DEMAND = 0.05;

/** Global stock bounds — reuse the legacy supply floor/ceiling. */
export const STOCK_MIN = ECONOMY_CONSTANTS.MIN_LEVEL;
export const STOCK_MAX = ECONOMY_CONSTANTS.MAX_LEVEL;

/**
 * Pricing anchors — the stock level where a good's mid price equals its basePrice.
 * Measured by running the simulator (`npm run simulate`) to a stable state and
 * reading each good's mean settling stock from the stock-drift report.
 *
 * Every good is pinned because consumption is universal (every system consumes
 * every good), so there are no neutral markets to hold a good's average at the
 * supply-band midpoint — each good settles at its own level. See
 * docs/active/gameplay/economy.md.
 */
const CALIBRATED_TARGET_STOCK: Record<string, number> = {
  // Tier 0.
  water: 122,
  food: 101,
  ore: 127,
  textiles: 108,
  // Tier 1.
  fuel: 85,
  metals: 90,
  chemicals: 81,
  medicine: 79,
  // Tier 2.
  electronics: 47,
  machinery: 46,
  weapons: 46,
  luxuries: 39,
};

/**
 * Pricing anchor: the stock level where the mid price equals basePrice. Uses the
 * measured per-good anchor, falling back to the supply-band midpoint for any good
 * without one.
 */
export function getTargetStock(goodId: string): number {
  const calibrated = CALIBRATED_TARGET_STOCK[goodId];
  if (calibrated != null) return calibrated;
  const eq = GOODS[goodId]?.equilibrium;
  if (!eq) return Math.round((STOCK_MIN + STOCK_MAX) / 2);
  return Math.round((eq.produces + eq.consumes) / 2);
}

/**
 * The per-market demand rate — the days-of-supply denominator. Equals the
 * system's base physical consumption for the good (perCapitaNeed × population),
 * floored at MIN_DEMAND. Government consumptionBoost and prosperity are
 * deliberately excluded: they move price through stock, not through the
 * reference. Stored on StationMarket.demandRate and used to build the price curve.
 */
export function marketDemandRate(
  aggregate: ResourceVector,
  population: number,
  goodId: string,
): number {
  const { consumption } = physicalRates(goodId, aggregate, population);
  return Math.max(consumption, MIN_DEMAND);
}

/**
 * Initial stock for a market at seed/reset time, from the system's net balance
 * for the good. A net producer seeds high (toward the producer equilibrium →
 * reads cheap); a net consumer seeds low (toward the consumer equilibrium →
 * reads dear); a balanced or inert market seeds at the pricing anchor. The
 * producer share blends continuously between the two equilibria.
 */
export function getInitialStock(
  aggregate: ResourceVector,
  population: number,
  goodId: string,
): number {
  const eq = GOODS[goodId]?.equilibrium;
  if (!eq) return getTargetStock(goodId);

  const { production, consumption } = physicalRates(goodId, aggregate, population);
  const total = production + consumption;
  if (total <= 0) return getTargetStock(goodId);

  const producerShare = production / total; // 1 = pure producer, 0 = pure consumer
  return Math.round(eq.consumes + producerShare * (eq.produces - eq.consumes));
}

/**
 * Bid-ask half-spread scaled by government margin policy. Repurposes the
 * government's `equilibriumSpreadPct` (frontier wide, authoritarian tight) to
 * scale the market spread now that the dual supply/demand band is gone.
 */
export function getSpread(govDef?: GovernmentDefinition): number {
  if (!govDef) return DEFAULT_SPREAD;
  return Math.max(0, DEFAULT_SPREAD * (1 + govDef.equilibriumSpreadPct / 100));
}
