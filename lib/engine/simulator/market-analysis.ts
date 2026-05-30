/**
 * Market health analysis — snapshot collection and derived metrics.
 *
 * Snapshots are sampled periodically during the simulation. Derived metrics
 * (price dispersion, stock drift) are computed post-simulation from the final
 * world state.
 */

import { spotPrice, curveForGood } from "@/lib/engine/market-pricing";
import { getTargetStock } from "@/lib/constants/market-economy";
import type { SimWorld, MarketSnapshot, MarketHealthSummary } from "./types";

/** Default: sample every 50 ticks. */
export const SNAPSHOT_INTERVAL = 50;

/** Take a snapshot of all market prices at the current tick. */
export function takeMarketSnapshot(world: SimWorld): MarketSnapshot[] {
  return world.markets.map((m) => ({
    systemId: m.systemId,
    goodId: m.goodId,
    stock: m.stock,
    price: spotPrice(curveForGood(m.goodId, m.basePrice, m.priceFloor, m.priceCeiling, m.anchorMult), m.stock),
  }));
}

/** Compute market health summary from the final world state. */
export function computeMarketHealth(world: SimWorld): MarketHealthSummary {
  return {
    priceDispersion: computePriceDispersion(world),
    stockDrift: computeStockDrift(world),
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
    const price = spotPrice(curveForGood(m.goodId, m.basePrice, m.priceFloor, m.priceCeiling, m.anchorMult), m.stock);
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
 * For each good, compute the average distance of stock from its targetStock
 * across all systems. Positive drift = above target (cheap), negative = below
 * target (expensive). The further from zero, the more the pricing anchor is off.
 */
function computeStockDrift(
  world: SimWorld,
): { goodId: string; avgStockDrift: number }[] {
  const driftsByGood = new Map<string, number[]>();

  for (const m of world.markets) {
    const drift = m.stock - getTargetStock(m.goodId);
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
