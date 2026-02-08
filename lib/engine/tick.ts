/**
 * Economy simulation tick engine.
 * Adjusts supply/demand based on economy type, production, and consumption.
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

/**
 * Returns a random integer between min and max (inclusive).
 */
function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Clamp a value between a minimum and maximum.
 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Simulate one economy tick across all market entries.
 *
 * For each entry:
 *   - If the good is produced by this economy type: supply += random(1,5), demand -= random(0,2)
 *   - If the good is consumed by this economy type: supply -= random(1,3), demand += random(1,5)
 *   - Apply small random drift: supply += random(-2,2), demand += random(-2,2)
 *   - Clamp supply and demand to [5, 200]
 *
 * Returns a new array (does not mutate input).
 */
export function simulateEconomyTick(
  markets: MarketTickEntry[],
): MarketTickEntry[] {
  return markets.map((entry) => {
    let { supply, demand } = entry;

    // Production effect
    if (entry.produces.includes(entry.goodId)) {
      supply += randInt(1, 5);
      demand -= randInt(0, 2);
    }

    // Consumption effect
    if (entry.consumes.includes(entry.goodId)) {
      supply -= randInt(1, 3);
      demand += randInt(1, 5);
    }

    // Random drift
    supply += randInt(-2, 2);
    demand += randInt(-2, 2);

    // Clamp
    supply = clamp(supply, 5, 200);
    demand = clamp(demand, 5, 200);

    return { ...entry, supply, demand };
  });
}
