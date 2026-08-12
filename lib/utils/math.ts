/**
 * Clamp a value between a minimum and maximum.
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Percentage width for a progress-bar fill, from a workDone/workTotal fraction in [0,1] — the same
 * convention every progress consumer in the codebase uses (`progressOf` in
 * `lib/engine/construction-readout.ts`, `ConstructionRow`'s `valueText`). The ×100 conversion
 * belongs here, at render time, rather than upstream: a component that stored progress pre-scaled
 * to 0-100 would be the one value in the codebase reading differently from every other consumer of
 * the same field, which is exactly the trap `TrackerRow` used to fall into (its track rendered a
 * fraction straight as a percentage, so a project at 55% drew a 0.55%-wide sliver). Out-of-range
 * input is clamped so a bad upstream value can't draw a fill past 100% or a negative width.
 */
export function progressWidthPct(fraction: number): number {
  return clamp(fraction * 100, 0, 100);
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

/**
 * Middle value of `xs`, averaging the two middle entries for an even-length list.
 * Empty input is 0 rather than NaN — harness cohorts can legitimately be empty, and
 * NaN must never reach serialized output.
 */
export function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Value at quantile `q` of `xs`. Empty input is 0, for the same reason as `median`. */
export function quantile(xs: number[], q: number): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}
