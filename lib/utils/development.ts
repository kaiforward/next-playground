/**
 * Absolute development heat ramp for the development map mode. Unlike population
 * (normalised per render to the visible max), development is an ABSOLUTE 0..1
 * magnitude, so the ramp maps the value directly: 0 = raw frontier (cool slate),
 * 1 = fully built-out (warm gold). Cool→warm reads as "cold frontier, hot
 * capital", the sanity gradient the stat is validated against.
 */

/** Ramp anchors, low→high, as [value, [r, g, b]]. */
const DEVELOPMENT_RAMP: ReadonlyArray<
  readonly [number, readonly [number, number, number]]
> = [
  [0, [71, 85, 105]], //   #475569 slate — raw frontier
  [0.5, [217, 119, 6]], // #d97706 copper — developing
  [1, [252, 211, 77]], //  #fcd34d gold — fully developed
];

/** CSS gradient stops (slate → copper → gold) for the legend. */
export const DEVELOPMENT_RAMP_CSS = ["#475569", "#d97706", "#fcd34d"] as const;

function clamp01(t: number): number {
  if (Number.isNaN(t)) return 0;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

function lerpChannel(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

/** [r,g,b] for a development value (0..1), interpolated across the ramp anchors. */
function rampRgb(value: number): [number, number, number] {
  const t = clamp01(value);
  for (let i = 0; i < DEVELOPMENT_RAMP.length - 1; i++) {
    const [lo, loRgb] = DEVELOPMENT_RAMP[i];
    const [hi, hiRgb] = DEVELOPMENT_RAMP[i + 1];
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
  const [, last] = DEVELOPMENT_RAMP[DEVELOPMENT_RAMP.length - 1];
  return [last[0], last[1], last[2]];
}

/** CSS hex colour for a development value (0..1) — badge/legend usage. */
export function developmentRampColor(value: number): string {
  const [r, g, b] = rampRgb(value);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/** Numeric colour for Pixi tinting (choropleth fill). */
export function developmentRampColorPixi(value: number): number {
  const [r, g, b] = rampRgb(value);
  return (r << 16) | (g << 8) | b;
}
