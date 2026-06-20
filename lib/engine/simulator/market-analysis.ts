/**
 * Market health analysis — snapshot collection and derived metrics.
 *
 * Snapshots are sampled periodically during the simulation. Derived metrics
 * (price dispersion, stock drift) are computed post-simulation from the final
 * world state.
 */

import { spotPrice, curveForGood } from "@/lib/engine/market-pricing";
import { ECONOMY_CONSTANTS } from "@/lib/constants/economy";
import type { SimWorld, MarketSnapshot, MarketHealthSummary } from "./types";

/** Default: sample every 50 ticks. */
export const SNAPSHOT_INTERVAL = 50;

// A market within one noise step of a hard clamp is effectively pinned there:
// the tick re-clamps it every turn and noise only jitters it inside the band.
const FLOOR_BAND = ECONOMY_CONSTANTS.MIN_LEVEL + ECONOMY_CONSTANTS.NOISE_AMPLITUDE;
const CEILING_BAND = ECONOMY_CONSTANTS.MAX_LEVEL - ECONOMY_CONSTANTS.NOISE_AMPLITUDE;

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
    if (m.stock <= FLOOR_BAND) agg.floor += 1;
    else if (m.stock >= CEILING_BAND) agg.ceiling += 1;
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
