/** Percentage difference between current and base price. */
export function getPriceTrendPct(currentPrice: number, basePrice: number): number {
  if (basePrice === 0) return 0;
  return ((currentPrice - basePrice) / basePrice) * 100;
}
