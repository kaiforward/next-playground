/**
 * Economy simulation tick engine.
 * Mean-reverting drift: supply/demand pull toward equilibrium targets
 * with production/consumption effects and random noise.
 *
 * All functions are pure — no DB or constant imports.
 */

export interface MarketTickEntry {
  goodId: string;
  supply: number;
  demand: number;
  basePrice: number;
  economyType: string;
  produces: string[];
  consumes: string[];
}

export interface EconomySimParams {
  reversionRate: number;
  noiseAmplitude: number;
  minLevel: number;
  maxLevel: number;
  productionRate: number;
  consumptionRate: number;
  equilibrium: {
    produces: { supply: number; demand: number };
    consumes: { supply: number; demand: number };
    neutral: { supply: number; demand: number };
  };
}

/**
 * Clamp a value between a minimum and maximum.
 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Get the equilibrium target for a good at a station based on
 * whether the station's economy produces or consumes that good.
 */
function getEquilibrium(
  entry: MarketTickEntry,
  params: EconomySimParams,
): { supply: number; demand: number } {
  if (entry.produces.includes(entry.goodId)) return params.equilibrium.produces;
  if (entry.consumes.includes(entry.goodId)) return params.equilibrium.consumes;
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
 * Simulate one economy tick across all market entries using mean-reverting drift.
 *
 * For each entry:
 *   1. Compute equilibrium target based on economy type relationship to good
 *   2. Apply mean-reversion pull toward target (reversionRate × gap)
 *   3. Apply production effect (producers generate supply, reduce demand slightly)
 *   4. Apply consumption effect (consumers deplete supply, generate demand)
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
  const { reversionRate, noiseAmplitude, minLevel, maxLevel, productionRate, consumptionRate } = params;

  return markets.map((entry) => {
    const target = getEquilibrium(entry, params);

    // Random noise for supply and demand (independent draws)
    const supplyNoise = (rng() * 2 - 1) * noiseAmplitude;
    const demandNoise = (rng() * 2 - 1) * noiseAmplitude;

    // Start with mean-reverting drift
    let supply = driftValue(entry.supply, target.supply, reversionRate, supplyNoise, minLevel, maxLevel);
    let demand = driftValue(entry.demand, target.demand, reversionRate, demandNoise, minLevel, maxLevel);

    // Production effect: producers generate supply, slightly reduce demand
    if (entry.produces.includes(entry.goodId)) {
      supply = clamp(supply + productionRate, minLevel, maxLevel);
      demand = clamp(demand - Math.round(productionRate * 0.3), minLevel, maxLevel);
    }

    // Consumption effect: consumers deplete supply, generate demand
    if (entry.consumes.includes(entry.goodId)) {
      supply = clamp(supply - consumptionRate, minLevel, maxLevel);
      demand = clamp(demand + Math.round(consumptionRate * 0.5), minLevel, maxLevel);
    }

    return { ...entry, supply, demand };
  });
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
