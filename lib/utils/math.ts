/**
 * Clamp a value between a minimum and maximum.
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Weighted arithmetic mean of `values`, each weighted by the parallel entry in `weights`.
 * Used for intensive faction/region aggregates (e.g. stability weighted by population) so a
 * populous core dominates and a tiny outpost can't drag the number down — the map and the
 * faction Overview share this so their numbers can't drift. Empty input is 0 (no
 * divide-by-zero); a total weight of 0 degrades to a plain arithmetic mean rather than NaN.
 */
export function weightedMean(values: number[], weights: number[]): number {
  if (values.length === 0) return 0;
  let weightedSum = 0;
  let totalWeight = 0;
  for (let i = 0; i < values.length; i++) {
    const w = weights[i] ?? 0;
    weightedSum += values[i] * w;
    totalWeight += w;
  }
  if (totalWeight === 0) {
    return values.reduce((sum, v) => sum + v, 0) / values.length;
  }
  return weightedSum / totalWeight;
}
