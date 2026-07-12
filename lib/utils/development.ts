/**
 * Absolute development heat ramp for the development map mode. Unlike population
 * (normalised per render to the visible max), development is an ABSOLUTE 0..1
 * magnitude. The stat is intentionally squashed against the galaxy's biggest
 * potential, so almost every system sits in the bottom fifth (a fresh galaxy has
 * only ~20 developed homeworlds, topping out near 0.24). A linear ramp would spend
 * its whole slate→copper→gold range on 0..1 and leave the entire galaxy reading
 * slate, so a fixed display curve `shaped = value ^ DEVELOPMENT_RAMP_GAMMA`
 * (γ < 1) expands that low band for colour lookup only — it recolours the
 * choropleth and its legend, never the underlying stat. Endpoints are pinned
 * (0 → slate, 1 → gold), so the frontier stays cold and the reserved top stays
 * gold; the full 0..1 domain is preserved, so systems that later exceed natural
 * potential (robots / special housing) still differentiate toward the top.
 * Cool→warm reads as "cold frontier, hot capital", the sanity gradient the stat
 * is validated against.
 */

/** Display curve exponent (< 1) that expands the squashed low band for colour lookup. Medium lift. */
export const DEVELOPMENT_RAMP_GAMMA = 0.4;

/** Ramp anchors, low→high, as [value, [r, g, b]]. */
const DEVELOPMENT_RAMP: ReadonlyArray<
  readonly [number, readonly [number, number, number]]
> = [
  [0, [71, 85, 105]], //   #475569 slate — raw frontier
  [0.5, [217, 119, 6]], // #d97706 copper — developing
  [1, [252, 211, 77]], //  #fcd34d gold — fully developed
];

function clamp01(t: number): number {
  if (Number.isNaN(t)) return 0;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** The display curve: expand the squashed low band while pinning 0→0 and 1→1. */
export function shapeForRamp(value: number): number {
  return Math.pow(clamp01(value), DEVELOPMENT_RAMP_GAMMA);
}

function lerpChannel(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

/** [r,g,b] for a development value (0..1), shaped by the display curve then interpolated across the anchors. */
function rampRgb(value: number): [number, number, number] {
  const t = shapeForRamp(value);
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

/**
 * Positioned CSS gradient stops for the legend, sampled through the SAME display curve as the map fill
 * (so the legend bar shows the real shaping and never implies a linear ramp). Left→right = development
 * 0→1, "Frontier"→"Built-out".
 */
export const DEVELOPMENT_RAMP_CSS: readonly string[] = Array.from({ length: 13 }, (_, i) => {
  const dev = i / 12;
  return `${developmentRampColor(dev)} ${Math.round(dev * 100)}%`;
});
