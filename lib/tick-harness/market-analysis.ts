/**
 * Market health analysis — snapshot collection and derived metrics.
 *
 * Snapshots are sampled periodically during the simulation. Derived metrics
 * (price dispersion, stock drift) are computed post-simulation from the final
 * world state.
 */

import { spotPrice, curveForRow, marketBandForRow, midPriceAt } from "@/lib/engine/market-pricing";
import { classifyMarketState } from "@/lib/engine/directed-logistics";
import { brakeKnee } from "@/lib/engine/tick";
import { isEconomicallyActive } from "@/lib/engine/control";
import { DIRECTED_LOGISTICS } from "@/lib/constants/directed-logistics";
import { ECONOMY_SIM_PARAMS } from "@/lib/constants/economy";
import { GOODS } from "@/lib/constants/goods";
import { GOOD_RECIPE_CONSUMERS } from "@/lib/constants/recipes";
import { median, quantile } from "@/lib/utils/math";
import { toGoodMarketStates } from "@/lib/tick/processors/good-market-state";
import { marketRowsBySystem } from "@/lib/world/tick";
import type {
  MarketSnapshot, MarketHealthSummary,
  PriceLevelSummary, CoverLevelEntry, KneeBindingEntry,
} from "./types";
import type { TickSystem } from "@/lib/tick/rows";
import type { WorldFlowEvent, WorldMarket } from "@/lib/world/types";

/** Default: sample every 50 ticks. */
export const SNAPSHOT_INTERVAL = 50;

/**
 * Relative tolerance for "effectively pinned" in the pinning health metric — a
 * small fraction that sets the proximity buffer for a boundary pin. The floor
 * test measures it against `maxStock` (proximity to an empty market); the ceiling
 * test against the band width (proximity to the storage ceiling).
 */
const BAND_PROXIMITY_FRAC = 0.02;

/**
 * True when a market's stock sits at the true floor — stock ≈ 0, the Shortage
 * regime's resting point. The price-saturation point (minStock) is a pricing
 * construct, not a clamp; nothing pins there, and deep draws below it are the
 * crisis zone working as designed.
 */
export function nearBandFloor(m: WorldMarket, band: { minStock: number; maxStock: number }): boolean {
  return m.stock <= BAND_PROXIMITY_FRAC * band.maxStock;
}

function nearBandCeiling(m: WorldMarket, band: { minStock: number; maxStock: number }): boolean {
  const step = BAND_PROXIMITY_FRAC * (band.maxStock - band.minStock);
  return m.stock >= band.maxStock - step;
}

/** Take a snapshot of all market prices at the current tick. */
export function takeMarketSnapshot(markets: WorldMarket[]): MarketSnapshot[] {
  return markets.map((m) => ({
    systemId: m.systemId,
    goodId: m.goodId,
    stock: m.stock,
    price: spotPrice(curveForRow(m, GOODS[m.goodId]), m.stock),
  }));
}

/**
 * Compute market health summary from the final market state. `logisticsTargets` carries each
 * market's warehousing target (see `logisticsTargetsByKey`); it is required rather than optional
 * because omitting it would silently report zero deficits everywhere.
 */
export function computeMarketHealth(
  markets: WorldMarket[],
  logisticsTargets: Map<string, number>,
): MarketHealthSummary {
  return {
    priceDispersion: computePriceDispersion(markets),
    stockDrift: computeStockDrift(markets),
    stockPins: computeStockPins(markets),
    priceLevels: computePriceLevels(markets),
    coverLevels: computeCoverLevels(markets, logisticsTargets),
  };
}

// ── Price dispersion ────────────────────────────────────────────

/**
 * For each good, compute the standard deviation of its price across all systems.
 * High dispersion = price varies a lot between systems = arbitrage opportunity.
 * Low dispersion = prices are uniform = no reason to trade this good.
 */
function computePriceDispersion(
  markets: WorldMarket[],
): { goodId: string; avgStdDev: number }[] {
  // Group prices by good
  const pricesByGood = new Map<string, number[]>();
  for (const m of markets) {
    const price = spotPrice(curveForRow(m, GOODS[m.goodId]), m.stock);
    let prices = pricesByGood.get(m.goodId);
    if (!prices) {
      prices = [];
      pricesByGood.set(m.goodId, prices);
    }
    prices.push(price);
  }

  const result: { goodId: string; avgStdDev: number }[] = [];
  for (const [goodId, prices] of pricesByGood) {
    const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
    const variance = prices.reduce((sum, p) => sum + (p - mean) ** 2, 0) / prices.length;
    result.push({ goodId, avgStdDev: Math.sqrt(variance) });
  }

  return result.sort((a, b) => b.avgStdDev - a.avgStdDev);
}

// ── Stock drift ─────────────────────────────────────────────────

/**
 * For each good, compute the average distance of stock from each market's
 * per-system cycles-of-supply reference (TARGET_COVER × demandRate × anchorMult)
 * across all systems. Positive drift = above reference (cheap), negative = below
 * (expensive). The further from zero, the more stock has drifted from the level
 * where the good prices at base.
 */
function computeStockDrift(
  markets: WorldMarket[],
): { goodId: string; avgStockDrift: number }[] {
  const driftsByGood = new Map<string, number[]>();

  for (const m of markets) {
    const reference = curveForRow(m, GOODS[m.goodId]).targetStock;
    const drift = m.stock - reference;
    let drifts = driftsByGood.get(m.goodId);
    if (!drifts) {
      drifts = [];
      driftsByGood.set(m.goodId, drifts);
    }
    drifts.push(drift);
  }

  const result: { goodId: string; avgStockDrift: number }[] = [];
  for (const [goodId, drifts] of driftsByGood) {
    const avgStockDrift = drifts.reduce((a, b) => a + b, 0) / drifts.length;
    result.push({ goodId, avgStockDrift });
  }

  // Sort by absolute magnitude of stock drift (most drifted first).
  return result.sort((a, b) => Math.abs(b.avgStockDrift) - Math.abs(a.avgStockDrift));
}

// ── Stock pins ──────────────────────────────────────────────────

/**
 * For each good, the fraction of its markets pinned at the stock floor or
 * ceiling. A good floor-pinned galaxy-wide is starved — its own production, or
 * for a recipe good its local inputs, cannot meet demand; ceiling-pinned means
 * it floods. Distinct from stock drift, which can read deeply negative purely
 * because a high demand rate lifts the reference: a pin is a literally empty
 * market, the unambiguous supply pathology. Sorted by total pinned fraction
 * descending.
 */
function computeStockPins(
  markets: WorldMarket[],
): { goodId: string; floorFrac: number; ceilingFrac: number }[] {
  const byGood = new Map<string, { floor: number; ceiling: number; total: number }>();

  for (const m of markets) {
    let agg = byGood.get(m.goodId);
    if (!agg) {
      agg = { floor: 0, ceiling: 0, total: 0 };
      byGood.set(m.goodId, agg);
    }
    agg.total += 1;
    const band = marketBandForRow(m, GOODS[m.goodId]);
    if (nearBandFloor(m, band)) agg.floor += 1;
    else if (nearBandCeiling(m, band)) agg.ceiling += 1;
  }

  const result: { goodId: string; floorFrac: number; ceilingFrac: number }[] = [];
  for (const [goodId, agg] of byGood) {
    result.push({
      goodId,
      floorFrac: agg.floor / agg.total,
      ceilingFrac: agg.ceiling / agg.total,
    });
  }

  return result.sort(
    (a, b) => b.floorFrac + b.ceilingFrac - (a.floorFrac + a.ceilingFrac),
  );
}

// ── Price levels (price / basePrice, galaxy-wide) ───────────────
/**
 * Distribution of price/basePrice across every market — the direct floor-pinning
 * read. Mirrors the DB audit's PRICE LEVELS section: a galaxy stuck cheap (median
 * « 1, high cheapFrac) is the overproduction signature this phase fixes.
 */
function computePriceLevels(markets: WorldMarket[]): PriceLevelSummary {
  const ratios: number[] = [];
  for (const m of markets) {
    const good = GOODS[m.goodId];
    const price = midPriceAt(curveForRow(m, good), m.stock);
    ratios.push(price / good.basePrice);
  }
  const n = ratios.length || 1;
  const cheap = ratios.filter((r) => r < 0.9).length;
  const expensive = ratios.filter((r) => r > 1.1).length;
  return {
    median: median(ratios),
    p10: quantile(ratios, 0.1),
    p90: quantile(ratios, 0.9),
    cheapFrac: cheap / n,
    nearFrac: (ratios.length - cheap - expensive) / n,
    expensiveFrac: expensive / n,
  };
}

// ── Cover levels (stock vs the per-good stock targets) ──────────
/**
 * Per-good distribution of cover = stock / price anchor, plus the share of markets standing
 * below the live logistics deficit line and at/above the ordinary-donor line.
 *
 * **`medianCover` reads a different denominator from the two fractions, deliberately.** It measures
 * against the price anchor: cover is the pricing reading the supply/demand UI shows, and holding it
 * there keeps the series comparable across runs. `deficitFrac` and `surplusFrac` measure against the
 * demand-denominated logistics thresholds, because those are what the live rules read: a deficit is
 * `stock < logisticsTarget × DEFICIT_FRACTION` (what `classifyMarketState` sizes a deficit against),
 * a surplus is the ordinary-donor rule `stock ≥ donorReserve × SURPLUS_MARGIN` (with `donorReserve`
 * derived from the warehousing target via the constants' ratio). Anchor and demand denominators
 * coincide wherever real demand clears `MIN_DEMAND` and diverge below it, so a floored market can
 * legitimately show a low `medianCover` while not counting as a deficit — it is stocked for what it
 * actually uses.
 *
 * This is a stock-vs-target reading only. It does NOT apply the matcher's self-supply gate
 * (`production < demand`), so a producer standing below its target counts here while the live
 * matcher would skip it as a sink — `deficitFrac` is an upper bound on the markets logistics acts
 * on. Symmetrically, `surplusFrac` ignores the structural-exporter path (`production > demand`,
 * which ships far below the donor line and sources most hauls), so it is a lower bound on donors:
 * the share of markets holding a standing excess, not a haul forecast.
 *
 * A market with no entry in `logisticsTargets` (its system absent from the run's system rows)
 * is never counted as a deficit or a surplus — an unknown target is evidence of neither. A KNOWN
 * target of 0 is different: real demand is 0, the donor reserve is 0, and under the live donor rule
 * the market's entire stock is drawable (see `surplusDrawable`'s demand-0 branch) — so it counts as
 * a surplus whenever it holds any stock, and can never be a deficit.
 */
function computeCoverLevels(
  markets: WorldMarket[],
  logisticsTargets: Map<string, number>,
): CoverLevelEntry[] {
  const coversByGood = new Map<string, number[]>();
  const deficitsByGood = new Map<string, number>();
  const surplusesByGood = new Map<string, number>();
  // The donor floor rides the same demand denominator as the warehousing target, so it is
  // recovered from the target via the constants' ratio rather than threaded separately.
  const donorPerTarget =
    DIRECTED_LOGISTICS.DONOR_RESERVE_COVER / DIRECTED_LOGISTICS.WAREHOUSE_COVER;
  for (const m of markets) {
    const target = curveForRow(m, GOODS[m.goodId]).targetStock;
    if (target <= 0) continue;
    const list = coversByGood.get(m.goodId) ?? [];
    list.push(m.stock / target);
    coversByGood.set(m.goodId, list);

    const logisticsTarget = logisticsTargets.get(`${m.systemId}|${m.goodId}`);
    if (logisticsTarget === undefined) continue;
    if (logisticsTarget > 0 && m.stock < logisticsTarget * DIRECTED_LOGISTICS.DEFICIT_FRACTION) {
      deficitsByGood.set(m.goodId, (deficitsByGood.get(m.goodId) ?? 0) + 1);
    } else if (
      m.stock > 0 &&
      m.stock >= logisticsTarget * donorPerTarget * DIRECTED_LOGISTICS.SURPLUS_MARGIN
    ) {
      surplusesByGood.set(m.goodId, (surplusesByGood.get(m.goodId) ?? 0) + 1);
    }
  }
  const result: CoverLevelEntry[] = [];
  for (const [goodId, covers] of coversByGood) {
    result.push({
      goodId,
      medianCover: median(covers),
      surplusFrac: (surplusesByGood.get(goodId) ?? 0) / covers.length,
      deficitFrac: (deficitsByGood.get(goodId) ?? 0) / covers.length,
    });
  }
  return result.sort((a, b) => b.medianCover - a.medianCover);
}

// ── Demand hunting ────────────────────────────────────────────────

/**
 * Whether the network keeps chasing a demand signal that moves under it. Two readings, both on
 * industrial-input goods — the ones whose demand used to be stated at full capacity whatever the
 * factory was actually doing:
 *
 *   - `flipRate` — how often a market's reading REVERSES between deficit and surplus. A world
 *     whose stated appetite tracks its yard oscillates: it reads starved, gets filled, immediately
 *     reads glutted, gets drained, reads starved again. Balanced readings inside the dead band are
 *     not reversals and are skipped; a reversal is counted when a decided reading differs from that
 *     market's previous decided one, so an oscillation THROUGH the dead band still registers. A
 *     market's FIRST decided reading has nothing to reverse and sits outside the denominator.
 *   - `haulChurnRatio` — the share of delivered tonnage that leaves again as a donation. Capped per
 *     market at what was delivered into it — a cap on the amount, not a provenance match: a market
 *     that both receives and donates the same good over the run books up to its received tonnage
 *     as churn whichever came first, so an exporter that once imported reads a little churn.
 *
 * Both should fall as demand becomes honest, but they are read differently. `haulChurnRatio`
 * reads off the flow log, which every arm has, so it is an A/B delta. `flipRate` classifies off
 * the persisted use figure, which only arms that PERSIST that field carry — an arm predating it
 * yields no decided readings at all — so it is an absolute read on the shipped arm (expected to
 * sit low once demand is honest), never a delta against a base arm. Neither is a health bar on
 * its own — a busy network moves goods on legitimately.
 */
export interface DemandHuntingSummary {
  /** Share of comparable decided readings — those with a previous decided reading to reverse —
   *  that reversed it. Each market's first decided reading is excluded from the denominator. */
  flipRate: number;
  /** Delivered tonnage that was donated back out, over all delivered tonnage. */
  haulChurnRatio: number;
}

/** Cross-sample state for the flip half — one entry per market that has produced a decided reading. */
export interface DemandHuntingAccumulator {
  lastDecidedByKey: Map<string, "deficit" | "surplus">;
  decidedReadings: number;
  reversals: number;
}

export function newDemandHuntingAccumulator(): DemandHuntingAccumulator {
  return { lastDecidedByKey: new Map(), decidedReadings: 0, reversals: 0 };
}

/** Goods some recipe consumes — the population the hunting reading is taken over. */
const INDUSTRIAL_INPUT_GOODS = new Set(
  Object.keys(GOOD_RECIPE_CONSUMERS).filter((goodId) => (GOOD_RECIPE_CONSUMERS[goodId] ?? []).length > 0),
);

/**
 * Fold one cycle's market rows into the flip reading. Classification runs straight off the
 * persisted use figure — the same warehousing target the matcher measures against — so this costs
 * a pass over the rows rather than a galaxy-wide state rebuild. A row with no use figure is skipped
 * rather than classified against a zero target, which would read as permanently balanced.
 */
export function sampleDemandHunting(
  acc: DemandHuntingAccumulator,
  markets: ReadonlyArray<WorldMarket>,
): void {
  for (const m of markets) {
    if (!INDUSTRIAL_INPUT_GOODS.has(m.goodId)) continue;
    const useRate = m.honestUseRate;
    if (typeof useRate !== "number" || !Number.isFinite(useRate) || useRate <= 0) continue;

    const target = DIRECTED_LOGISTICS.WAREHOUSE_COVER * useRate * m.anchorMult;
    const { kind } = classifyMarketState(m.stock, target);
    if (kind === "balanced") continue;

    const key = `${m.systemId}|${m.goodId}`;
    acc.decidedReadings++;
    const previous = acc.lastDecidedByKey.get(key);
    if (previous !== undefined && previous !== kind) acc.reversals++;
    acc.lastDecidedByKey.set(key, kind);
  }
}

/** Fold the sampled flips and the run's whole flow log into the two hunting readings. */
export function summarizeDemandHunting(
  acc: DemandHuntingAccumulator,
  flows: ReadonlyArray<Pick<WorldFlowEvent, "fromSystemId" | "toSystemId" | "goodId" | "quantity">>,
): DemandHuntingSummary {
  const deliveredByKey = new Map<string, number>();
  const donatedByKey = new Map<string, number>();
  for (const f of flows) {
    if (!(f.quantity > 0)) continue;
    const into = `${f.toSystemId}|${f.goodId}`;
    const outOf = `${f.fromSystemId}|${f.goodId}`;
    deliveredByKey.set(into, (deliveredByKey.get(into) ?? 0) + f.quantity);
    donatedByKey.set(outOf, (donatedByKey.get(outOf) ?? 0) + f.quantity);
  }

  let delivered = 0;
  let churned = 0;
  for (const [key, inTonnage] of deliveredByKey) {
    delivered += inTonnage;
    // Only what a market both received AND sent on can be re-donated tonnage; anything beyond
    // that is its own production leaving.
    churned += Math.min(inTonnage, donatedByKey.get(key) ?? 0);
  }

  // Each market in the accumulator contributed exactly one first reading, which structurally
  // cannot reverse — leaving those in the denominator dilutes the rate, and unevenly: the
  // dilution grows as decided readings per market fall, which is what the honest arm does.
  const comparable = acc.decidedReadings - acc.lastDecidedByKey.size;
  return {
    flipRate: comparable > 0 ? acc.reversals / comparable : 0,
    haulChurnRatio: delivered > 0 ? churned / delivered : 0,
  };
}

// ── Knee-binding census ─────────────────────────────────────────

/**
 * Per good, which term set each producing market's brake geometry — "use" (warehousing),
 * "output" (working inventory) or "storage" (the physical yard clipped the ramp) — computed
 * from the same warehouse knee the tick applies: `brakeKnee` at `ECONOMY_SIM_PARAMS`, use
 * figure and reference-cycle capacity via `toGoodMarketStates`, the row's own `anchorMult`
 * and `storageCapacity`. A producing market is one with reference-cycle capacity > 0 at an
 * economically active system — the population the knee's output term describes. Counts per
 * good sum to that producing-market count (the instrument self-check its tests assert);
 * goods nobody produces are absent. This census is the evidence the storage-constant
 * re-sizing decision is later taken on.
 */
export function computeKneeBinding(
  systems: TickSystem[],
  markets: WorldMarket[],
): KneeBindingEntry[] {
  const rowsBySystem = marketRowsBySystem(markets);
  const byGood = new Map<string, { use: number; output: number; storage: number }>();
  for (const s of systems) {
    if (!isEconomicallyActive(s.control)) continue;
    const rows = rowsBySystem.get(s.id);
    if (!rows) continue;
    const rowByGood = new Map(rows.map((r) => [r.goodId, r]));
    const states = toGoodMarketStates({
      buildings: s.buildings, population: s.population, yields: s.yields, markets: rows,
    });
    for (const state of states) {
      if (state.capacityProduction <= 0) continue;
      const row = rowByGood.get(state.goodId);
      if (!row) continue;
      const knee = brakeKnee(
        {
          useRate: state.demand,
          capacityProduction: state.capacityProduction,
          anchorMult: row.anchorMult,
          storageCapacity: row.storageCapacity,
        },
        ECONOMY_SIM_PARAMS,
      );
      const counts = byGood.get(state.goodId) ?? { use: 0, output: 0, storage: 0 };
      counts[knee.bindingTerm]++;
      byGood.set(state.goodId, counts);
    }
  }
  return [...byGood.entries()]
    .map(([goodId, counts]) => ({ goodId, ...counts }))
    .sort((a, b) => a.goodId.localeCompare(b.goodId));
}
