/**
 * Market health analysis — snapshot collection and derived metrics.
 *
 * Snapshots are sampled periodically during the simulation. Derived metrics
 * (price dispersion, stock drift) are computed post-simulation from the final
 * world state.
 */

import { spotPrice, curveForGood, marketBand, midPriceAt } from "@/lib/engine/market-pricing";
import { ECONOMY_CONSTANTS } from "@/lib/constants/economy";
import { DIRECTED_LOGISTICS } from "@/lib/constants/directed-logistics";
import type {
  SimWorld, MarketSnapshot, MarketHealthSummary, SimMarketEntry,
  PriceLevelSummary, CoverLevelEntry,
} from "./types";

/** Default: sample every 50 ticks. */
export const SNAPSHOT_INTERVAL = 50;

/**
 * True when a market's stock is within one relative noise step of the given
 * band boundary. The noise step is `NOISE_FRACTION × (maxStock - minStock)` —
 * the same amplitude the tick engine uses. A market in this zone gets
 * re-clamped every turn and noise only jitters it inside the buffer.
 */
function nearBandFloor(m: SimMarketEntry, band: { minStock: number; maxStock: number }): boolean {
  const noiseStep = ECONOMY_CONSTANTS.NOISE_FRACTION * (band.maxStock - band.minStock);
  return m.stock <= band.minStock + noiseStep;
}

function nearBandCeiling(m: SimMarketEntry, band: { minStock: number; maxStock: number }): boolean {
  const noiseStep = ECONOMY_CONSTANTS.NOISE_FRACTION * (band.maxStock - band.minStock);
  return m.stock >= band.maxStock - noiseStep;
}

/** Take a snapshot of all market prices at the current tick. */
export function takeMarketSnapshot(world: SimWorld): MarketSnapshot[] {
  return world.markets.map((m) => ({
    systemId: m.systemId,
    goodId: m.goodId,
    stock: m.stock,
    price: spotPrice(curveForGood(m.basePrice, m.priceFloor, m.priceCeiling, m.demandRate, m.anchorMult), m.stock),
  }));
}

/** Compute market health summary from the final world state. */
export function computeMarketHealth(world: SimWorld): MarketHealthSummary {
  return {
    priceDispersion: computePriceDispersion(world),
    stockDrift: computeStockDrift(world),
    stockPins: computeStockPins(world),
    priceLevels: computePriceLevels(world),
    coverLevels: computeCoverLevels(world),
  };
}

// ── Price dispersion ────────────────────────────────────────────

/**
 * For each good, compute the standard deviation of its price across all systems.
 * High dispersion = price varies a lot between systems = arbitrage opportunity.
 * Low dispersion = prices are uniform = no reason to trade this good.
 */
function computePriceDispersion(
  world: SimWorld,
): { goodId: string; avgStdDev: number }[] {
  // Group prices by good
  const pricesByGood = new Map<string, number[]>();
  for (const m of world.markets) {
    const price = spotPrice(curveForGood(m.basePrice, m.priceFloor, m.priceCeiling, m.demandRate, m.anchorMult), m.stock);
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
 * per-system days-of-supply reference (TARGET_COVER × demandRate × anchorMult)
 * across all systems. Positive drift = above reference (cheap), negative = below
 * (expensive). The further from zero, the more stock has drifted from the level
 * where the good prices at base.
 */
function computeStockDrift(
  world: SimWorld,
): { goodId: string; avgStockDrift: number }[] {
  const driftsByGood = new Map<string, number[]>();

  for (const m of world.markets) {
    const reference = curveForGood(
      m.basePrice,
      m.priceFloor,
      m.priceCeiling,
      m.demandRate,
      m.anchorMult,
    ).targetStock;
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
 * because a high demand rate lifts the reference: a pin is the literal clamp,
 * the unambiguous supply pathology. Sorted by total pinned fraction descending.
 */
function computeStockPins(
  world: SimWorld,
): { goodId: string; floorFrac: number; ceilingFrac: number }[] {
  const byGood = new Map<string, { floor: number; ceiling: number; total: number }>();

  for (const m of world.markets) {
    let agg = byGood.get(m.goodId);
    if (!agg) {
      agg = { floor: 0, ceiling: 0, total: 0 };
      byGood.set(m.goodId, agg);
    }
    agg.total += 1;
    const band = marketBand({ demandRate: m.demandRate, storageCapacity: m.storageCapacity, priceFloor: m.priceFloor, priceCeiling: m.priceCeiling, anchorMult: m.anchorMult });
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

// ── Distribution helpers ────────────────────────────────────────
function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
function quantile(xs: number[], q: number): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

// ── Price levels (price / basePrice, galaxy-wide) ───────────────
/**
 * Distribution of price/basePrice across every market — the direct floor-pinning
 * read. Mirrors the DB audit's PRICE LEVELS section: a galaxy stuck cheap (median
 * « 1, high cheapFrac) is the overproduction signature this phase fixes.
 */
function computePriceLevels(world: SimWorld): PriceLevelSummary {
  const ratios: number[] = [];
  for (const m of world.markets) {
    const price = midPriceAt(
      curveForGood(m.basePrice, m.priceFloor, m.priceCeiling, m.demandRate, m.anchorMult),
      m.stock,
    );
    ratios.push(price / m.basePrice);
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

// ── Cover levels (stock / targetStock, per good) ────────────────
/**
 * Per-good distribution of cover = stock / anchor. Surplus/deficit use the same
 * thresholds as directed logistics so the sim read lines up with the live audit.
 */
function computeCoverLevels(world: SimWorld): CoverLevelEntry[] {
  const coversByGood = new Map<string, number[]>();
  for (const m of world.markets) {
    const target = curveForGood(
      m.basePrice, m.priceFloor, m.priceCeiling, m.demandRate, m.anchorMult,
    ).targetStock;
    if (target <= 0) continue;
    const list = coversByGood.get(m.goodId) ?? [];
    list.push(m.stock / target);
    coversByGood.set(m.goodId, list);
  }
  const result: CoverLevelEntry[] = [];
  for (const [goodId, covers] of coversByGood) {
    const surplus = covers.filter((c) => c >= DIRECTED_LOGISTICS.SURPLUS_MARGIN).length;
    const deficit = covers.filter((c) => c < DIRECTED_LOGISTICS.DEFICIT_FRACTION).length;
    result.push({
      goodId,
      medianCover: median(covers),
      surplusFrac: surplus / covers.length,
      deficitFrac: deficit / covers.length,
    });
  }
  return result.sort((a, b) => b.medianCover - a.medianCover);
}
