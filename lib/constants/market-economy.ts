/**
 * Constants for the stock-based market economy. See
 * docs/active/gameplay/economy.md.
 */

import { ECONOMY_CONSTANTS } from "@/lib/constants/economy";
import { physicalRates } from "@/lib/engine/physical-economy";
import { GOOD_CONSUMPTION } from "@/lib/constants/physical-economy";
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
 * dispersion across all goods, so staples (deep cover) and advanced goods
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
 * Days-of-supply demand denominator for one good: max(perCapitaNeed × population,
 * MIN_DEMAND). Population-only (consumption ignores the resource vector), so it is
 * the formula the population processor uses to rewrite demandRate as population moves.
 */
export function demandRateForGood(goodId: string, population: number): number {
  const need = GOOD_CONSUMPTION[goodId] ?? 0;
  return Math.max(need * Math.max(0, population), MIN_DEMAND);
}

/**
 * Per-good demand a population of this size generates, descending by magnitude —
 * the consumption footprint that drives each market's demandRate. Only goods with
 * a positive per-capita need appear; each entry equals demandRateForGood (so it
 * floors at MIN_DEMAND). Pure, population-only — matches demandRateForGood.
 */
export function demandFootprint(population: number): Array<{ goodId: string; demandRate: number }> {
  return Object.keys(GOOD_CONSUMPTION)
    .filter((goodId) => GOOD_CONSUMPTION[goodId] > 0)
    .map((goodId) => ({ goodId, demandRate: demandRateForGood(goodId, population) }))
    .sort((a, b) => b.demandRate - a.demandRate);
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
  // reference = TARGET_COVER × demandRate; demandRate is floored consumption (see demandRateForGood).
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
