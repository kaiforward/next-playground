/**
 * Constants for the stock-based market economy. See
 * docs/active/gameplay/economy.md.
 */

import { ECONOMY_CONSTANTS } from "@/lib/constants/economy";
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
 *
 * Calibrated via `npm run simulate`: 40 maximises the minimum cross-system price
 * dispersion across all twelve goods, so staples (deep cover) and advanced goods
 * (thin cover) are both tradeable at once. Lower values pin advanced goods to the
 * price floor (cheap everywhere); higher values pin staples to the ceiling.
 */
export const TARGET_COVER = 40;

/**
 * Floor on the days-of-supply denominator so a near-empty system yields a finite
 * cover instead of a divide-by-zero / zero reference. First-draft value; tuned via `npm run simulate`.
 */
export const MIN_DEMAND = 0.05;

/**
 * Seed-cover multipliers on the per-system reference: a pure consumer seeds at
 * SEED_COVER_MIN (shallow cover → dear), a pure producer at SEED_COVER_MAX (deep
 * cover → cheap), blended by producer share. First-draft values; tuned via `npm run simulate`.
 */
export const SEED_COVER_MIN = 0.5;
export const SEED_COVER_MAX = 1.5;

/** Global stock bounds — reuse the legacy supply floor/ceiling. */
export const STOCK_MIN = ECONOMY_CONSTANTS.MIN_LEVEL;
export const STOCK_MAX = ECONOMY_CONSTANTS.MAX_LEVEL;

/**
 * The per-market demand rate — the days-of-supply denominator. Equals the
 * system's base physical consumption for the good (perCapitaNeed × population),
 * floored at MIN_DEMAND. Government consumptionBoost is deliberately excluded:
 * it moves price through stock, not through the reference. Stored on
 * StationMarket.demandRate and used to build the price curve.
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
 * Initial stock for a market at seed/reset time, derived from the system's net
 * balance for the good around its per-system days-of-supply reference
 * (TARGET_COVER × demandRate). A net producer seeds with deeper cover (reads
 * cheap), a net consumer with shallower cover (reads dear); a balanced or inert
 * market seeds at the reference (reads at base price). Clamped to the stock band.
 */
export function getInitialStock(
  aggregate: ResourceVector,
  population: number,
  goodId: string,
): number {
  const { production, consumption } = physicalRates(goodId, aggregate, population);
  // reference = TARGET_COVER × demandRate; demandRate is floored consumption (see marketDemandRate).
  const reference = TARGET_COVER * Math.max(consumption, MIN_DEMAND);
  const total = production + consumption;

  const producerShare = total > 0 ? production / total : 0.5; // 1 producer, 0 consumer
  const coverMult = SEED_COVER_MIN + producerShare * (SEED_COVER_MAX - SEED_COVER_MIN);
  return Math.round(Math.max(STOCK_MIN, Math.min(STOCK_MAX, reference * coverMult)));
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
