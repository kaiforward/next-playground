/**
 * Market health analysis — snapshot collection and derived metrics.
 *
 * Snapshots are sampled periodically during the simulation. Derived metrics
 * (price dispersion, stock drift) are computed post-simulation from the final
 * world state.
 */

import { spotPrice, curveForRow, marketBandForRow, midPriceAt } from "@/lib/engine/market-pricing";
import { DIRECTED_LOGISTICS } from "@/lib/constants/directed-logistics";
import { GOODS } from "@/lib/constants/goods";
import { median, quantile } from "@/lib/utils/math";
import type {
  MarketSnapshot, MarketHealthSummary,
  PriceLevelSummary, CoverLevelEntry,
} from "./types";
import type { WorldMarket } from "@/lib/world/types";

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
 * below the live logistics deficit line.
 *
 * **The two halves read different denominators, deliberately.** `medianCover` and `surplusFrac`
 * measure against the price anchor: cover is the pricing reading the supply/demand UI shows, and
 * holding it there keeps the series comparable across runs. It is a reporting convention, not a
 * replay of the donor rule — an ordinary donor measures its excess against `donorReserve`
 * (`DONOR_RESERVE_COVER × real demand`), so on a floored market `surplusFrac` no longer describes
 * who will actually give something away. `deficitFrac` measures against the warehousing target
 * (`logisticsTarget = WAREHOUSE_COVER × real demand`), because that is what `classifyMarketState`
 * sizes a deficit against. Anchor and demand denominators coincide wherever real demand clears
 * `MIN_DEMAND` and diverge below it, so a floored market can legitimately show a low
 * `medianCover` while not counting as a deficit — it is stocked for what it actually uses.
 *
 * This is a stock-vs-target reading only. It does NOT apply the matcher's self-supply gate
 * (`production < demand`), so a producer standing below its target counts here while the live
 * matcher would skip it as a sink. `deficitFrac` is therefore an upper bound on the markets
 * logistics acts on, not an exact replay of the match.
 *
 * A market with no entry in `logisticsTargets` (its system absent from the run's system rows)
 * is never counted as a deficit — an unknown target is not evidence of need.
 */
function computeCoverLevels(
  markets: WorldMarket[],
  logisticsTargets: Map<string, number>,
): CoverLevelEntry[] {
  const coversByGood = new Map<string, number[]>();
  const deficitsByGood = new Map<string, number>();
  for (const m of markets) {
    const target = curveForRow(m, GOODS[m.goodId]).targetStock;
    if (target <= 0) continue;
    const list = coversByGood.get(m.goodId) ?? [];
    list.push(m.stock / target);
    coversByGood.set(m.goodId, list);

    const logisticsTarget = logisticsTargets.get(`${m.systemId}|${m.goodId}`) ?? 0;
    const isDeficit = logisticsTarget > 0
      && m.stock < logisticsTarget * DIRECTED_LOGISTICS.DEFICIT_FRACTION;
    if (isDeficit) deficitsByGood.set(m.goodId, (deficitsByGood.get(m.goodId) ?? 0) + 1);
  }
  const result: CoverLevelEntry[] = [];
  for (const [goodId, covers] of coversByGood) {
    const surplus = covers.filter((c) => c >= DIRECTED_LOGISTICS.SURPLUS_MARGIN).length;
    result.push({
      goodId,
      medianCover: median(covers),
      surplusFrac: surplus / covers.length,
      deficitFrac: (deficitsByGood.get(goodId) ?? 0) / covers.length,
    });
  }
  return result.sort((a, b) => b.medianCover - a.medianCover);
}
