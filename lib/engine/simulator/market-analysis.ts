/**
 * Market health analysis — snapshot collection and derived metrics.
 *
 * Snapshots are sampled periodically during the simulation. Derived metrics
 * (price dispersion, equilibrium drift) are computed post-simulation from
 * the final world state.
 */

import { calculatePrice } from "@/lib/engine/pricing";
import type { SimWorld, SimSystem, MarketSnapshot, MarketHealthSummary } from "./types";
import type { SimConstants } from "./constants";

/** Default: sample every 50 ticks. */
export const SNAPSHOT_INTERVAL = 50;

/** Take a snapshot of all market prices at the current tick. */
export function takeMarketSnapshot(world: SimWorld): MarketSnapshot[] {
  return world.markets.map((m) => ({
    systemId: m.systemId,
    goodId: m.goodId,
    supply: m.supply,
    demand: m.demand,
    price: calculatePrice(m.basePrice, m.supply, m.demand),
  }));
}

/** Compute market health summary from the final world state. */
export function computeMarketHealth(
  world: SimWorld,
  constants: SimConstants,
): MarketHealthSummary {
  return {
    priceDispersion: computePriceDispersion(world),
    equilibriumDrift: computeEquilibriumDrift(world, constants),
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
    const price = calculatePrice(m.basePrice, m.supply, m.demand);
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

// ── Equilibrium drift ───────────────────────────────────────────

/**
 * For each good, compute the average distance of supply and demand from
 * their equilibrium targets across all systems. Positive drift = above
 * equilibrium, negative = below.
 */
function computeEquilibriumDrift(
  world: SimWorld,
  constants: SimConstants,
): { goodId: string; avgSupplyDrift: number; avgDemandDrift: number }[] {
  const systemMap = new Map<string, SimSystem>();
  for (const sys of world.systems) {
    systemMap.set(sys.id, sys);
  }

  // Accumulate drift per good
  const driftByGood = new Map<string, { supplyDrifts: number[]; demandDrifts: number[] }>();

  for (const m of world.markets) {
    const sys = systemMap.get(m.systemId);
    if (!sys) continue;

    // Determine equilibrium target based on produce/consume relationship
    let eqSupply: number;
    let eqDemand: number;
    if (m.goodId in sys.produces) {
      eqSupply = constants.equilibrium.produces.supply;
      eqDemand = constants.equilibrium.produces.demand;
    } else if (m.goodId in sys.consumes) {
      eqSupply = constants.equilibrium.consumes.supply;
      eqDemand = constants.equilibrium.consumes.demand;
    } else {
      eqSupply = constants.equilibrium.neutral.supply;
      eqDemand = constants.equilibrium.neutral.demand;
    }

    let entry = driftByGood.get(m.goodId);
    if (!entry) {
      entry = { supplyDrifts: [], demandDrifts: [] };
      driftByGood.set(m.goodId, entry);
    }

    entry.supplyDrifts.push(m.supply - eqSupply);
    entry.demandDrifts.push(m.demand - eqDemand);
  }

  const result: { goodId: string; avgSupplyDrift: number; avgDemandDrift: number }[] = [];
  for (const [goodId, { supplyDrifts, demandDrifts }] of driftByGood) {
    const avgSupplyDrift = supplyDrifts.reduce((a, b) => a + b, 0) / supplyDrifts.length;
    const avgDemandDrift = demandDrifts.reduce((a, b) => a + b, 0) / demandDrifts.length;
    result.push({ goodId, avgSupplyDrift, avgDemandDrift });
  }

  // Sort by absolute magnitude of supply drift (most drifted first)
  return result.sort(
    (a, b) => Math.abs(b.avgSupplyDrift) + Math.abs(b.avgDemandDrift)
            - Math.abs(a.avgSupplyDrift) - Math.abs(a.avgDemandDrift),
  );
}
