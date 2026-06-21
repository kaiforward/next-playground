/**
 * Economy simulation tick engine — single-stock model.
 *
 * Each market holds one `stock` value. Producers add stock (self-limiting near
 * the ceiling), consumers drain it (self-limiting near the floor), then noise is
 * applied and the value is clamped to each market's own [minStock, maxStock] band. There is no
 * mean-reversion and no `demand` axis — equilibrium emerges spatially via the
 * trade-flow processor. See docs/active/gameplay/economy.md (Per-Tick Simulation).
 *
 * All functions are pure — no DB or constant imports.
 */

import { clamp } from "@/lib/utils/math";
import type { GeneratedTrait } from "@/lib/engine/trait-gen";

export interface MarketTickEntry {
  goodId: string;
  stock: number;
  /** Stock floor for this market entry — scarcity reserve and buy-price floor. */
  minStock: number;
  /** Stock ceiling for this market entry — demand headroom and sell-price floor. */
  maxStock: number;
  /** Per-good base production rate (undefined/0 = not a producer of this good). */
  productionRate?: number;
  /** Per-good base consumption rate (undefined/0 = not a consumer of this good). */
  consumptionRate?: number;
  /** Multiplier on production rate from events. Default 1.0. */
  productionMult?: number;
  /** Multiplier on consumption rate from events. Default 1.0. */
  consumptionMult?: number;
  /** Per-good volatility multiplier on noise amplitude. Default 1.0. */
  volatility?: number;
}

export interface EconomySimParams {
  /** Noise as a fraction of the per-entry band width (maxStock - minStock). */
  noiseFraction: number;
}

/**
 * Self-limiting scale factor (sqrt curve). Returns 0 at the boundary and 1 at
 * the opposite extreme; sqrt keeps rates active through mid-range and only drops
 * sharply near the extremes.
 */
export function selfLimitingFactor(
  value: number,
  min: number,
  max: number,
  direction: "produce" | "consume",
): number {
  const range = max - min;
  if (range <= 0) return 0;
  const ratio =
    direction === "produce"
      ? (max - value) / range // production slows as stock approaches the ceiling
      : (value - min) / range; // consumption slows as stock approaches the floor
  return Math.sqrt(Math.max(0, Math.min(1, ratio)));
}

/**
 * Simulate one economy tick across all market entries.
 *
 * For each entry: applies production when `productionRate > 0`, consumption
 * when `consumptionRate > 0`, then noise, then clamp to each entry's own [minStock, maxStock] band.
 * Accepts an optional RNG for deterministic testing. Returns a new array.
 */
export function simulateEconomyTick(
  markets: MarketTickEntry[],
  params: EconomySimParams,
  rng: () => number = Math.random,
): MarketTickEntry[] {
  const { noiseFraction } = params;

  return markets.map((entry) => {
    let stock = entry.stock;
    const { minStock, maxStock } = entry;

    const effectiveProduction = (entry.productionRate ?? 0) * (entry.productionMult ?? 1);
    if (effectiveProduction > 0) {
      stock += effectiveProduction * selfLimitingFactor(stock, minStock, maxStock, "produce");
    }

    const effectiveConsumption = (entry.consumptionRate ?? 0) * (entry.consumptionMult ?? 1);
    if (effectiveConsumption > 0) {
      stock -= effectiveConsumption * selfLimitingFactor(stock, minStock, maxStock, "consume");
    }

    const noise = (rng() * 2 - 1) * noiseFraction * (maxStock - minStock) * (entry.volatility ?? 1);
    stock = clamp(stock + noise, minStock, maxStock);

    return { ...entry, stock };
  });
}

// ── Tick entry builder ──────────────────────────────────────────

/**
 * Pre-resolved inputs for building a MarketTickEntry. Callers resolve
 * data-source-specific values (DB vs SimWorld) into this common shape; the
 * builder handles shared computation (trait bonus, gov consumption boost).
 */
export interface TickEntryInput {
  goodId: string;
  stock: number;
  /** Stock floor for this market entry — resolved upstream from the pricing-band. */
  minStock: number;
  /** Stock ceiling for this market entry — resolved upstream from the pricing-band. */
  maxStock: number;
  /** Volatility after government scaling. */
  volatility: number;
  /** Base production rate from the substrate driver (undefined = not a producer). */
  baseProductionRate?: number;
  /** Base consumption rate from the substrate driver (undefined = not a consumer). */
  baseConsumptionRate?: number;
  /** Government consumption boost for this good. */
  govConsumptionBoost: number;
  /** System traits (already validated). */
  traits: GeneratedTrait[];
  /** Production-only suppression multiplier (1 = none). Strike state from unrest. */
  productionSuppress?: number;
}

/**
 * Build a MarketTickEntry from pre-resolved inputs. Folds the government
 * consumption boost into the consumption rate. Callers spread event
 * productionMult/consumptionMult on top if present.
 */
export function buildMarketTickEntry(input: TickEntryInput): MarketTickEntry {
  const productionRate =
    input.baseProductionRate != null
      ? input.baseProductionRate * (input.productionSuppress ?? 1)
      : undefined;

  const consumptionRate =
    input.baseConsumptionRate != null
      ? input.baseConsumptionRate + input.govConsumptionBoost
      : undefined;

  return {
    goodId: input.goodId,
    stock: input.stock,
    minStock: input.minStock,
    maxStock: input.maxStock,
    productionRate,
    consumptionRate,
    volatility: input.volatility,
  };
}

// ── Ship arrival processing ─────────────────────────────────────

export interface InTransitShip {
  id: string;
  arrivalTick: number;
}

/**
 * Given a list of in-transit ships and the current tick,
 * returns the IDs of ships that have arrived (arrivalTick <= currentTick).
 * Pure function — no DB dependency.
 */
export function processShipArrivals(
  ships: InTransitShip[],
  currentTick: number,
): string[] {
  return ships
    .filter((ship) => ship.arrivalTick <= currentTick)
    .map((ship) => ship.id);
}
