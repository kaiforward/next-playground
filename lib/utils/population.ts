/**
 * Relative population heat ramp for the population map mode. Unlike stability
 * (a fixed 0…1 unrest value → band), population is normalised per render to the
 * highest value among the currently visible systems: `ratio` 1 = the fullest
 * system on screen (green), 0 = zero population (red). The amber midpoint keeps
 * mid values legible instead of muddy through a direct red→green lerp. The
 * anchor hexes are shared with the stability ramp so the map palette stays
 * coherent (green = "most", red = "least"); the semantic is the layer's, not
 * the colour's.
 */

/** Ramp anchors, low→high, as [ratio, [r, g, b]]. */
const POPULATION_RAMP: ReadonlyArray<
  readonly [number, readonly [number, number, number]]
> = [
  [0, [239, 68, 68]], //   #ef4444 red   — zero population
  [0.5, [245, 158, 11]], // #f59e0b amber — mid
  [1, [34, 197, 94]], //   #22c55e green — highest visible
];

/** CSS gradient stops (red → amber → green) for the legend. */
export const POPULATION_RAMP_CSS = ["#ef4444", "#f59e0b", "#22c55e"] as const;

function clamp01(t: number): number {
  if (Number.isNaN(t)) return 0;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

function lerpChannel(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

/** [r,g,b] for a population ratio (0…1), interpolated across the ramp anchors. */
function rampRgb(ratio: number): [number, number, number] {
  const t = clamp01(ratio);
  for (let i = 0; i < POPULATION_RAMP.length - 1; i++) {
    const [lo, loRgb] = POPULATION_RAMP[i];
    const [hi, hiRgb] = POPULATION_RAMP[i + 1];
    if (t <= hi) {
      const span = hi - lo;
      const local = span > 0 ? (t - lo) / span : 0;
      return [
        lerpChannel(loRgb[0], hiRgb[0], local),
        lerpChannel(loRgb[1], hiRgb[1], local),
        lerpChannel(loRgb[2], hiRgb[2], local),
      ];
    }
  }
  const [, last] = POPULATION_RAMP[POPULATION_RAMP.length - 1];
  return [last[0], last[1], last[2]];
}

/** CSS hex colour for a population ratio (0…1) — badge/legend usage. */
export function populationRampColor(ratio: number): string {
  const [r, g, b] = rampRgb(ratio);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/** Numeric colour for Pixi tinting (choropleth fill). */
export function populationRampColorPixi(ratio: number): number {
  const [r, g, b] = rampRgb(ratio);
  return (r << 16) | (g << 8) | b;
}
