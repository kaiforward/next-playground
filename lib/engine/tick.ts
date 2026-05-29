/**
 * Economy simulation tick engine — single-stock model.
 *
 * Each market holds one `stock` value. Producers add stock (self-limiting near
 * the ceiling), consumers drain it (self-limiting near the floor), then noise is
 * applied and the value is clamped to [minLevel, maxLevel]. There is no
 * mean-reversion and no `demand` axis — equilibrium emerges spatially via the
 * trade-flow processor. See docs/planned/stock-based-market-economy.md §3.
 *
 * All functions are pure — no DB or constant imports.
 */

import { clamp } from "@/lib/utils/math";
import type { GeneratedTrait } from "@/lib/engine/trait-gen";
import { computeTraitProductionBonus } from "@/lib/engine/trait-gen";

export interface MarketTickEntry {
  goodId: string;
  stock: number;
  economyType: string;
  produces: string[];
  consumes: string[];
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
  noiseAmplitude: number;
  minLevel: number;
  maxLevel: number;
}

/**
 * Self-limiting scale factor (sqrt curve). Returns 0 at the boundary and 1 at
 * the opposite extreme; sqrt keeps rates active through mid-range and only drops
 * sharply near the extremes.
 */
function selfLimitingFactor(
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
 * For each entry: apply self-limiting production (if a producer), self-limiting
 * consumption (if a consumer), then noise, then clamp to [minLevel, maxLevel].
 * Accepts an optional RNG for deterministic testing. Returns a new array.
 */
export function simulateEconomyTick(
  markets: MarketTickEntry[],
  params: EconomySimParams,
  rng: () => number = Math.random,
): MarketTickEntry[] {
  const { noiseAmplitude, minLevel, maxLevel } = params;

  return markets.map((entry) => {
    let stock = entry.stock;

    const effectiveProduction = (entry.productionRate ?? 0) * (entry.productionMult ?? 1);
    if (effectiveProduction > 0 && entry.produces.includes(entry.goodId)) {
      stock += effectiveProduction * selfLimitingFactor(stock, minLevel, maxLevel, "produce");
    }

    const effectiveConsumption = (entry.consumptionRate ?? 0) * (entry.consumptionMult ?? 1);
    if (effectiveConsumption > 0 && entry.consumes.includes(entry.goodId)) {
      stock -= effectiveConsumption * selfLimitingFactor(stock, minLevel, maxLevel, "consume");
    }

    const noise = (rng() * 2 - 1) * noiseAmplitude * (entry.volatility ?? 1);
    stock = clamp(stock + noise, minLevel, maxLevel);

    return { ...entry, stock };
  });
}

// ── Tick entry builder ──────────────────────────────────────────

/**
 * Pre-resolved inputs for building a MarketTickEntry. Callers resolve
 * data-source-specific values (DB vs SimWorld) into this common shape; the
 * builder handles shared computation (trait bonus, gov consumption boost,
 * prosperity scaling).
 */
export interface TickEntryInput {
  goodId: string;
  stock: number;
  economyType: string;
  produces: string[];
  consumes: string[];
  /** Volatility after government scaling. */
  volatility: number;
  /** Base production rate from economy type (undefined = not a producer). */
  baseProductionRate?: number;
  /** Base consumption rate from economy type (undefined = not a consumer). */
  baseConsumptionRate?: number;
  /** Government consumption boost for this good. */
  govConsumptionBoost: number;
  /** System traits (already validated). */
  traits: GeneratedTrait[];
  /** System prosperity value. */
  prosperity: number;
}

/**
 * Build a MarketTickEntry from pre-resolved inputs. Computes the trait
 * production bonus, folds the government consumption boost into the consumption
 * rate, and applies the prosperity multiplier equally to both rates. Callers
 * spread event productionMult/consumptionMult on top if present.
 */
export function buildMarketTickEntry(
  input: TickEntryInput,
  prosperityParams: ProsperityParams,
): MarketTickEntry {
  const prosperityMult = getProsperityMultiplier(input.prosperity, prosperityParams);

  const traitBonus = computeTraitProductionBonus(input.traits, input.goodId);
  const productionBeforeProsperity =
    input.baseProductionRate != null ? input.baseProductionRate * (1 + traitBonus) : undefined;

  const consumptionBeforeProsperity =
    input.baseConsumptionRate != null
      ? input.baseConsumptionRate + input.govConsumptionBoost
      : input.govConsumptionBoost > 0
        ? input.govConsumptionBoost
        : undefined;

  return {
    goodId: input.goodId,
    stock: input.stock,
    economyType: input.economyType,
    produces: input.produces,
    consumes: input.consumes,
    productionRate:
      productionBeforeProsperity != null ? productionBeforeProsperity * prosperityMult : undefined,
    consumptionRate:
      consumptionBeforeProsperity != null ? consumptionBeforeProsperity * prosperityMult : undefined,
    volatility: input.volatility,
  };
}

// ── Prosperity system ───────────────────────────────────────────

export interface ProsperityParams {
  decayRate: number;
  maxGain: number;
  targetVolume: number;
  min: number;
  max: number;
  multAtMin: number;
  multAtZero: number;
  multAtMax: number;
}

/**
 * Compute new prosperity value after one processor run.
 * Trade volume pushes toward +1, decay pulls toward 0.
 * Only events (not modeled here) can push below 0.
 */
export function updateProsperity(
  current: number,
  tradeVolume: number,
  params: ProsperityParams,
): number {
  // Gain from trade: proportional to volume, capped at maxGain
  const volumeRatio = Math.min(tradeVolume / params.targetVolume, 1);
  const gain = volumeRatio * params.maxGain;

  // Decay toward 0 (at most decayRate per run, never overshooting past 0)
  const absCurrent = Math.abs(current);
  const decay = absCurrent > 0
    ? Math.sign(current) * Math.min(params.decayRate, absCurrent)
    : 0;

  const next = current - decay + gain;
  return clamp(next, params.min, params.max);
}

/**
 * Get the production/consumption multiplier from a prosperity value.
 * Both production and consumption get the SAME multiplier (no opposing tug-of-war).
 *
 * Piecewise linear:
 *   [-1, 0] → [multAtMin, multAtZero]
 *   [0, +1] → [multAtZero, multAtMax]
 */
export function getProsperityMultiplier(prosperity: number, params: ProsperityParams): number {
  if (prosperity <= 0) {
    // Interpolate between multAtMin (-1) and multAtZero (0)
    const t = (prosperity + 1); // 0 at -1, 1 at 0
    return params.multAtMin + t * (params.multAtZero - params.multAtMin);
  }
  // Interpolate between multAtZero (0) and multAtMax (+1)
  return params.multAtZero + prosperity * (params.multAtMax - params.multAtZero);
}

export type ProsperityLabel = "Crisis" | "Disrupted" | "Stagnant" | "Active" | "Booming";

/**
 * Get the human-readable label for a prosperity value.
 */
export function getProsperityLabel(prosperity: number): ProsperityLabel {
  if (prosperity <= -0.5) return "Crisis";
  if (prosperity <= -0.1) return "Disrupted";
  if (prosperity <= 0.3) return "Stagnant";
  if (prosperity <= 0.7) return "Active";
  return "Booming";
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
