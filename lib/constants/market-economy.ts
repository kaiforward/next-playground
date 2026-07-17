/**
 * Constants for the stock-based market economy. See
 * docs/active/gameplay/economy.md.
 */

import { GOOD_CONSUMPTION } from "@/lib/constants/physical-economy";
import { scaleValue } from "@/lib/constants/economy-scale";
import {
  buildingProduction,
  computeLabourState,
  computeSystemLabourSnapshot,
  facilityStorageForGood,
  inputDemandForGood,
} from "@/lib/engine/industry";
import type { LabourState } from "@/lib/engine/industry";
import { consumptionRate } from "@/lib/engine/physical-economy";
import type { CivilianDemandBasis } from "@/lib/engine/physical-economy";
import { GOODS } from "@/lib/constants/goods";
import { marketBand } from "@/lib/engine/market-pricing";
import type { ResourceVector } from "@/lib/types/game";

/** Price-curve elasticity. k=1 reproduces the legacy demand/supply hyperbola. */
export const DEFAULT_ELASTICITY = 1;

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
export const MIN_DEMAND = scaleValue(0.05);

/**
 * Seed-cover multipliers on the per-system reference: a pure consumer seeds at
 * SEED_COVER_MIN (shallow cover → dear), a pure producer at SEED_COVER_MAX (deep
 * cover → cheap), blended by producer share. First-draft values; tuned via `npm run simulate`.
 */
export const SEED_COVER_MIN = 0.5;
export const SEED_COVER_MAX = 1.5;

/**
 * Days-of-supply demand denominator for one good: max(civilian consumption,
 * MIN_DEMAND). Civilian-only (base per-capita + skilled baskets — see
 * consumptionRate); the population processor recomputes it as population and
 * the labour allocation move.
 */
export function civilianDemandRateForGood(goodId: string, basis: CivilianDemandBasis): number {
  return Math.max(consumptionRate(goodId, basis), MIN_DEMAND);
}

/**
 * Total days-of-supply demand denominator: civilian (demand basis) + industrial
 * (production-input draw). The industrial term is capacity-based and stable —
 * it depends on the industrial base and labour ratio, not on this tick's stock.
 * The labour state is skill-gated exactly like the tick's actual production — a
 * tier-1/2 system with no academy correctly forecasts zero (not phantom) input
 * demand. Callers rewriting every market of a system pass a precomputed
 * `labourState` (computed once per system); otherwise it is derived here.
 * `yields` is the system's per-resource yield multiplier vector (pass unitResourceVector()
 * when real yields are not yet available).
 */
export function totalDemandRateForGood(
  goodId: string,
  basis: CivilianDemandBasis,
  buildings: Record<string, number>,
  yields: ResourceVector,
  labourState?: LabourState,
): number {
  const civilian = consumptionRate(goodId, basis);
  const state = labourState ?? computeLabourState(buildings, basis.population);
  const industrial = inputDemandForGood(buildings, goodId, state, yields);
  return Math.max(civilian + industrial, MIN_DEMAND);
}

/**
 * Per-good CIVILIAN demand a system's demand basis generates, descending by
 * magnitude — the population's own consumption footprint (what the Population
 * panel's demand chart renders), NOT the stored WorldMarket.demandRate pricing
 * anchor (which also folds in industrial input draw — see totalDemandRateForGood).
 * Only goods with a positive per-capita need appear; each entry equals
 * civilianDemandRateForGood (so it floors at MIN_DEMAND). Pure — driven by the
 * civilian demand basis.
 */
export function demandFootprint(basis: CivilianDemandBasis): Array<{ goodId: string; civilianDemandRate: number }> {
  return Object.keys(GOOD_CONSUMPTION)
    .filter((goodId) => GOOD_CONSUMPTION[goodId] > 0)
    .map((goodId) => ({ goodId, civilianDemandRate: civilianDemandRateForGood(goodId, basis) }))
    .sort((a, b) => b.civilianDemandRate - a.civilianDemandRate);
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
  const snap = computeSystemLabourSnapshot(buildings, population);
  const production = buildingProduction(buildings, goodId, snap.state, yields);
  const consumption = consumptionRate(goodId, snap.basis);

  const demandRate = civilianDemandRateForGood(goodId, snap.basis);
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
  // Stock is a continuous float balance — do NOT round to whole units. Rounding the seed
  // quantizes it (~0.3% error at ECONOMY_SCALE=1, negligible at 100), which breaks the
  // goods-side scale-invariance from tick 0 and compounds through every economy pulse.
  return Math.max(band.minStock, Math.min(band.maxStock, band.targetStock * coverMult));
}
