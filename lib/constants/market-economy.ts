/**
 * Constants for the stock-based market economy. See
 * docs/active/gameplay/economy.md.
 */

import { GOOD_CONSUMPTION } from "@/lib/constants/physical-economy";
import {
  buildingProduction,
  facilityStorageForGood,
  inputDemandForGood,
  labourDemand,
  labourFulfillment,
} from "@/lib/engine/industry";
import { GOODS } from "@/lib/constants/goods";
import { marketBand } from "@/lib/engine/market-pricing";
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
 * The single global cover lever for the 26-good roster: at 40, every good keeps
 * non-trivial cross-system price dispersion, so staples (deep cover) and advanced
 * goods (thin cover) are both tradeable at once. Lower values pin advanced goods
 * to the price floor (cheap everywhere); higher values pin staples to the ceiling.
 * Per-good imbalances are tuned via each good's production coeff / per-capita need
 * (see physical-economy.ts); this stays the whole-roster knob.
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
 * Total days-of-supply demand denominator: civilian (population) + industrial
 * (production-input draw). The industrial term is capacity-based and stable —
 * it depends on the industrial base and labour ratio, not on this tick's stock.
 * `fulfillment` is the system-wide labour ratio
 * (`labourFulfillment(population, labourDemand(buildings))`).
 * `yields` is the system's per-resource yield multiplier vector (pass unitResourceVector()
 * when real yields are not yet available).
 */
export function totalDemandRateForGood(
  goodId: string,
  population: number,
  buildings: Record<string, number>,
  fulfillment: number,
  yields: ResourceVector,
): number {
  const civilian = (GOOD_CONSUMPTION[goodId] ?? 0) * Math.max(0, population);
  const industrial = inputDemandForGood(buildings, goodId, fulfillment, yields);
  return Math.max(civilian + industrial, MIN_DEMAND);
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
 * balance for the good around its per-market band. The band is demand-priced
 * (targetStock = TARGET_COVER × demandRate, the price anchor) and
 * infrastructure-stocked (maxStock adds facilityStorageForGood on top of the
 * demand headroom). A net producer seeds with deeper cover (reads cheap), a net
 * consumer with shallower cover (reads dear). Clamped to [band.minStock,
 * band.maxStock].
 *
 * Uses the same building-block formula `capacityGoodRates` does, but for a
 * single good (avoids an O(goods²) seed when called per good).
 */
export function getInitialStock(
  buildings: Record<string, number>,
  yields: ResourceVector,
  population: number,
  goodId: string,
): number {
  const fulfillment = labourFulfillment(population, labourDemand(buildings));
  const production = buildingProduction(buildings, goodId, fulfillment, yields);
  const consumption = (GOOD_CONSUMPTION[goodId] ?? 0) * Math.max(0, population);

  const demandRate = demandRateForGood(goodId, population);
  const g = GOODS[goodId];
  const band = g
    ? marketBand({
        demandRate,
        storageCapacity: facilityStorageForGood(buildings, goodId),
        priceFloor: g.priceFloor,
        priceCeiling: g.priceCeiling,
      })
    : marketBand({ demandRate, storageCapacity: facilityStorageForGood(buildings, goodId), priceFloor: 0.5, priceCeiling: 2.0 });

  const total = production + consumption;
  const producerShare = total > 0 ? production / total : 0.5; // 1 producer, 0 consumer
  const coverMult = SEED_COVER_MIN + producerShare * (SEED_COVER_MAX - SEED_COVER_MIN);
  return Math.round(Math.max(band.minStock, Math.min(band.maxStock, band.targetStock * coverMult)));
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
