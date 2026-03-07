/**
 * Economy simulation tick engine.
 * Mean-reverting drift: supply/demand pull toward equilibrium targets
 * with production/consumption effects and random noise.
 *
 * All functions are pure — no DB or constant imports.
 */

import { clamp } from "@/lib/utils/math";
import type { GeneratedTrait } from "@/lib/engine/trait-gen";
import { computeTraitProductionBonus } from "@/lib/engine/trait-gen";

export interface MarketTickEntry {
  goodId: string;
  supply: number;
  demand: number;
  basePrice: number;
  economyType: string;
  produces: string[];
  consumes: string[];
  /** Multiplier on the supply equilibrium target. Default 1. */
  supplyTargetMult?: number;
  /** Multiplier on the demand equilibrium target. Default 1. */
  demandTargetMult?: number;
  /** Multiplier on production rate. Default 1.0. */
  productionMult?: number;
  /** Multiplier on consumption rate. Default 1.0. */
  consumptionMult?: number;
  /** Multiplier on reversion rate (dampening). Default 1.0. */
  reversionMult?: number;
  /** Per-good base production rate. Overrides params.productionRate when present. */
  productionRate?: number;
  /** Per-good base consumption rate. Overrides params.consumptionRate when present. */
  consumptionRate?: number;
  /** Per-good volatility multiplier on noise amplitude. Default 1.0. */
  volatility?: number;
  /** Per-good equilibrium target for producing systems. Overrides params.equilibrium.produces. */
  equilibriumProduces?: { supply: number; demand: number };
  /** Per-good equilibrium target for consuming systems. Overrides params.equilibrium.consumes. */
  equilibriumConsumes?: { supply: number; demand: number };
}

export interface EconomySimParams {
  reversionRate: number;
  noiseAmplitude: number;
  minLevel: number;
  maxLevel: number;
  equilibrium: {
    produces: { supply: number; demand: number };
    consumes: { supply: number; demand: number };
    neutral: { supply: number; demand: number };
  };
}

/**
 * Get the equilibrium target for a good at a station based on
 * whether the station's economy produces or consumes that good.
 */
function getEquilibrium(
  entry: MarketTickEntry,
  params: EconomySimParams,
): { supply: number; demand: number } {
  if (entry.produces.includes(entry.goodId)) return entry.equilibriumProduces ?? params.equilibrium.produces;
  if (entry.consumes.includes(entry.goodId)) return entry.equilibriumConsumes ?? params.equilibrium.consumes;
  return params.equilibrium.neutral;
}

/**
 * Drift a single value toward its target with noise.
 *
 * Mean reversion: pull toward target by reversionRate fraction of the gap.
 * Noise: random uniform in [-noiseAmplitude, +noiseAmplitude].
 */
function driftValue(
  current: number,
  target: number,
  reversionRate: number,
  noise: number,
  min: number,
  max: number,
): number {
  const reversion = (target - current) * reversionRate;
  return clamp(Math.round(current + reversion + noise), min, max);
}

/**
 * Self-limiting scale factor (sqrt curve).
 * Returns 0 at the boundary and 1 at the opposite extreme.
 * Uses sqrt to keep rates active through mid-range — only drops sharply near extremes.
 */
function selfLimitingFactor(value: number, min: number, max: number, direction: "produce" | "consume"): number {
  const range = max - min;
  if (range <= 0) return 0;
  const ratio = direction === "produce"
    ? (max - value) / range   // production slows as supply approaches ceiling
    : (value - min) / range;  // consumption slows as supply approaches floor
  return Math.sqrt(Math.max(0, Math.min(1, ratio)));
}

/**
 * Simulate one economy tick across all market entries using mean-reverting drift.
 *
 * For each entry:
 *   1. Compute equilibrium target based on economy type relationship to good
 *   2. Apply mean-reversion pull toward target (reversionRate × gap)
 *   3. Apply self-limiting production effect (scales down near ceiling)
 *   4. Apply self-limiting consumption effect (scales down near floor)
 *   5. Add random noise
 *   6. Clamp to [minLevel, maxLevel]
 *
 * Accepts an optional RNG for deterministic testing; defaults to Math.random.
 * Returns a new array (does not mutate input).
 */
export function simulateEconomyTick(
  markets: MarketTickEntry[],
  params: EconomySimParams,
  rng: () => number = Math.random,
): MarketTickEntry[] {
  const { reversionRate, noiseAmplitude, minLevel, maxLevel } = params;

  return markets.map((entry) => {
    const target = getEquilibrium(entry, params);

    // Apply modifier multipliers to equilibrium targets (default 1)
    const effectiveSupplyTarget = target.supply * (entry.supplyTargetMult ?? 1);
    const effectiveDemandTarget = target.demand * (entry.demandTargetMult ?? 1);

    // Apply reversion dampening (default 1.0 = no change)
    const effectiveReversion = reversionRate * (entry.reversionMult ?? 1);

    // Per-good volatility scales noise amplitude (default 1.0)
    const effectiveNoise = noiseAmplitude * (entry.volatility ?? 1);

    // Random noise for supply and demand (independent draws)
    const supplyNoise = (rng() * 2 - 1) * effectiveNoise;
    const demandNoise = (rng() * 2 - 1) * effectiveNoise;

    // Start with mean-reverting drift toward modified targets
    let supply = driftValue(entry.supply, effectiveSupplyTarget, effectiveReversion, supplyNoise, minLevel, maxLevel);
    let demand = driftValue(entry.demand, effectiveDemandTarget, effectiveReversion, demandNoise, minLevel, maxLevel);

    // Apply per-good base rates with modifier multipliers
    const effectiveProduction = (entry.productionRate ?? 0) * (entry.productionMult ?? 1);
    const effectiveConsumption = (entry.consumptionRate ?? 0) * (entry.consumptionMult ?? 1);

    // Production: producers generate supply
    // Self-limiting: scales down as supply approaches ceiling (warehouses full)
    if (entry.produces.includes(entry.goodId)) {
      const prodScale = selfLimitingFactor(supply, minLevel, maxLevel, "produce");
      supply = clamp(supply + effectiveProduction * prodScale, minLevel, maxLevel);
    }

    // Consumption: consumers deplete supply
    // Self-limiting: scales down as supply approaches floor (nothing to consume)
    if (entry.consumes.includes(entry.goodId)) {
      const consScale = selfLimitingFactor(supply, minLevel, maxLevel, "consume");
      supply = clamp(supply - effectiveConsumption * consScale, minLevel, maxLevel);
    }

    return { ...entry, supply, demand };
  });
}

// ── Tick entry builder ──────────────────────────────────────────

/**
 * Pre-resolved inputs for building a MarketTickEntry.
 * Callers resolve data-source-specific values (DB vs SimWorld)
 * into this common shape; the builder handles shared computation
 * (trait bonus, prosperity scaling, rate assembly).
 */
export interface TickEntryInput {
  goodId: string;
  supply: number;
  demand: number;
  basePrice: number;
  economyType: string;
  produces: string[];
  consumes: string[];
  /** Volatility after government scaling. */
  volatility: number;
  /** Per-good equilibrium overrides (after gov spread adjustment). */
  equilibriumProduces?: { supply: number; demand: number };
  equilibriumConsumes?: { supply: number; demand: number };
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
 * Build a MarketTickEntry from pre-resolved inputs.
 *
 * Computes: trait production bonus, consumption with gov boost,
 * prosperity multiplier on both rates. Callers spread event
 * modifier fields (supplyTargetMult, etc.) on top if present.
 */
export function buildMarketTickEntry(
  input: TickEntryInput,
  prosperityParams: ProsperityParams,
): MarketTickEntry {
  const prosperityMult = getProsperityMultiplier(input.prosperity, prosperityParams);

  // Trait production bonus: effectiveRate = baseRate × (1 + traitBonus)
  const traitBonus = computeTraitProductionBonus(input.traits, input.goodId);
  const productionBeforeProsperity = input.baseProductionRate != null
    ? input.baseProductionRate * (1 + traitBonus)
    : undefined;

  // Consumption with government boost
  const consumptionBeforeProsperity = input.baseConsumptionRate != null
    ? input.baseConsumptionRate + input.govConsumptionBoost
    : input.govConsumptionBoost > 0 ? input.govConsumptionBoost : undefined;

  // Apply prosperity multiplier to both production and consumption equally
  const productionRate = productionBeforeProsperity != null
    ? productionBeforeProsperity * prosperityMult
    : undefined;
  const consumptionRate = consumptionBeforeProsperity != null
    ? consumptionBeforeProsperity * prosperityMult
    : undefined;

  return {
    goodId: input.goodId,
    supply: input.supply,
    demand: input.demand,
    basePrice: input.basePrice,
    economyType: input.economyType,
    produces: input.produces,
    consumes: input.consumes,
    productionRate,
    consumptionRate,
    volatility: input.volatility,
    equilibriumProduces: input.equilibriumProduces,
    equilibriumConsumes: input.equilibriumConsumes,
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
