/**
 * Calculate the current price of a good based on supply and demand.
 *
 * Formula: price = basePrice * (demand / supply)
 * Clamped to [0.2 * basePrice, 5.0 * basePrice].
 * If supply is 0, returns 5.0 * basePrice (maximum price).
 */
export function calculatePrice(
  basePrice: number,
  supply: number,
  demand: number,
): number {
  if (supply <= 0) {
    return Math.round(5.0 * basePrice);
  }

  const raw = basePrice * (demand / supply);
  const min = 0.2 * basePrice;
  const max = 5.0 * basePrice;
  const clamped = Math.max(min, Math.min(max, raw));

  return Math.round(clamped);
}
