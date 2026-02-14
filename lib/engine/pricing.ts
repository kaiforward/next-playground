/**
 * Calculate the current price of a good based on supply and demand.
 *
 * Formula: price = basePrice * (demand / supply)
 * Clamped to [minMult * basePrice, maxMult * basePrice].
 * If supply is 0, returns maxMult * basePrice (maximum price).
 *
 * @param minMult - Minimum price multiplier (default 0.2)
 * @param maxMult - Maximum price multiplier (default 5.0)
 */
export function calculatePrice(
  basePrice: number,
  supply: number,
  demand: number,
  minMult = 0.2,
  maxMult = 5.0,
): number {
  if (supply <= 0) {
    return Math.round(maxMult * basePrice);
  }

  const raw = basePrice * (demand / supply);
  const min = minMult * basePrice;
  const max = maxMult * basePrice;
  const clamped = Math.max(min, Math.min(max, raw));

  return Math.round(clamped);
}
