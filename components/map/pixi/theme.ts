import type { SunClass } from "@/lib/types/game";

// Neutral tint for the far-zoom point cloud. The zoomed-in system dot is coloured
// by star type (SUN_CLASS_COLORS_PIXI); distant points stay neutral.
export const NEUTRAL_GLYPH = { core: 0xcbd5e1, glow: 0x64748b } as const; // slate-300 / slate-500

/** Star-type dot palette (Pixi 0xRRGGBB) — mirrors SUN_CLASS_COLORS (lib/constants/ui.ts). */
export const SUN_CLASS_COLORS_PIXI: Record<SunClass, number> = {
  yellow:       0xfacc15,
  blue_white:   0x93c5fd,
  orange_dwarf: 0xfb923c,
  red_dwarf:    0xf87171,
};

// ── Territory (universe view) ────────────────────────────────────

// `strokeColor` is the neutral border used by the Regions layer (no economy
// tint); `fillAlpha`/`strokeAlpha`/`strokeWidth` are shared by the choropleth
// territory layers (stability/population/development), which paint their own
// per-value colour into this shared alpha/width envelope.
export const TERRITORY = {
  strokeColor: 0x64748b, // slate-500, matches NEUTRAL_GLYPH.glow — Regions border only
  fillAlpha: 0.08,
  strokeAlpha: 0.3,
  strokeWidth: 2,
} as const;

// ── Lane style (level, `objects/lane-style.ts`) ───────────────────
// The base lane layer says only "where the lanes are": one uniform width, widened a little per
// invested level and a bit more for a major (crossing-priced) fuel tier — no colour, no dashes.
// Load/blocked meaning belongs to the Lanes map mode, not this layer.
export const LANE_WIDTH = {
  base: 1.5,
  majorExtra: 1.0,
  perLevel: 0.35,
} as const;

/** The base lane layer's one colour and alpha — slate, always, regardless of tier/level/load. */
export const LANE_BASE_COLOR = 0x64748b; // slate-500
export const LANE_BASE_ALPHA = 0.5;

/** Presentation-only threshold on `bookedLoad / capacity` (unclamped) that separates the "busy"
 *  band from "fine" (`objects/lane-band.ts`) — set by eye in the visual smoke, not a mechanic
 *  read anywhere else. Congestion (`blockedVolume > 0`) always wins over this regardless of load. */
export const LANE_BUSY_LOAD_FRACTION = 0.75;

/** Status colours for the three lane bands (`objects/lane-band.ts`) — the design system's
 *  green/amber/red triple (docs/active/design-system/theme.md → Status Colors), reused here rather
 *  than a bespoke colour set of its own. */
export const LANE_BAND_COLOR: Record<"fine" | "busy" | "congested", number> = {
  fine: 0x22c55e, // green-500
  busy: 0xf59e0b, // amber-500
  congested: 0xef4444, // red-500
} as const;

/** The selected lane's highlight stroke (the open `/lane/:key` route) — Foundry copper, matching the
 *  developed settlement mark. */
export const LANE_SELECTED = {
  color: 0xd06a42,
  glowWidth: 9.0,
  glowAlpha: 0.35,
} as const;

/** The hovered lane's highlight stroke — a white/slate-100 glow, narrower and fainter than the
 *  selection glow (`LANE_SELECTED`) so the two never read as the same state. */
export const LANE_HOVERED = {
  color: 0xf1f5f9, // slate-100
  glowWidth: 5.0,
  glowAlpha: 0.25,
} as const;

/**
 * The Lanes map mode's lane style (`objects/lane-style.ts`'s `laneModeStyle`) — a stronger width
 * ramp than the base layer's, since this mode carries meaning rather than mere position. `fineAlpha`
 * dims an uncongested/unbusy lane so a busy or congested one (`busyAlpha`, full) stands out;
 * `pulsePeriodMs`/`pulseColor` drive the congested overlay stroke (`ConnectionLayer.update`).
 */
export const LANE_MODE = {
  baseWidth: 1.2,
  perLevel: 0.6,
  fineAlpha: 0.45,
  busyAlpha: 0.95,
  pulsePeriodMs: 1400,
  pulseColor: 0xef4444, // red-500, matches LANE_BAND_COLOR.congested
} as const;

/** Screen-pixel tolerance for the lane click hit-test (`lane-hit-test.ts`'s `findLaneAt`) — divided
 *  by the camera zoom at click time so a thin lane is as easy to hit zoomed out as zoomed in. Generous
 *  enough to forgive a slightly-off click without swallowing nearby cell clicks. */
export const LANE_HIT_TOLERANCE_PX = 8;

// ── Point cloud (universe view) ─────────────────────────────────

export const POINT_CLOUD = {
  dotRadius: 3,
  gatewayScale: 1.5,
  textureSize: 16,
} as const;

export const VIEW_TIERS = {
  universeMax: 0.3,   // below this = pure universe view
  systemMin: 0.4,     // above this = pure system view
  bufferStart: 0.28,  // start creating SystemObjects before crossfade
} as const;

/** Zoom at/below which a stage click selects a FACTION (its union), not the individual system.
 *  Aligned with DEFAULT_TIER_THRESHOLDS.factionToRegion (number-aggregation.ts) — the zoom below which
 *  the faction number tier + unions dominate. Calibration knob; keep these two in step when tuning. */
export const FACTION_SELECT_ZOOM = 0.285;

// ── Sizes ────────────────────────────────────────────────────────

export const SIZES = {
  systemCoreRadius:   12,
  systemGlowRadius:   40,
  systemHitRadius:    20,
  systemLabelSize:    14,
  regionWidth:       180,
  regionHeight:      100,
  regionCornerRadius: 12,
  regionLabelSize:    14,
  regionSubLabelSize: 10,
  gatewayDotRadius:    5,
  dashLength:          6,
  dashGap:             4,
} as const;

// ── Glyph radial budget (world units, glyph-local) ───────────────
// Each concentric element owns a fixed radius band so the star bloom, hover
// ring, and selection ring never collide.
export const GLYPH = {
  coreRadius:        12,   // star-type dot core (matches SIZES.systemCoreRadius)
  bloomRadius:       20,   // dim same-hue under-disc — a soft star bloom, no halo
  hoverRingRadius:   19,   // star-coloured ring shown on hover
  navRingRadius:     34,   // outermost, dashed
  selectedRingWidth: 4,    // selection ring — bright white dashed focus ring
} as const;

// ── Settlement mark (player systems: controlled / forming / developed) ──
// A square badge at the star's north-east shoulder — approved prototype:
// hollow slate = claimed, hollow amber + expanding pulse = colony forming,
// solid copper = developed. Corners get a small radius (Pixi rasterises sharp
// corners as aliased mush — the deliberate HTML-only exception to Foundry's
// no-rounding rule, see map-rendering.md → Gotchas).
export const SETTLEMENT_MARK = {
  size: 16,               // badge side, world units
  offsetX: 12,            // badge left edge from glyph centre
  offsetY: -28,           // badge top edge from glyph centre
  cornerRadius: 2.5,
  strokeWidth: 2,
  backingColor: 0x030712, // = BG_COLOR — opaque so territory fills don't bleed through
  backingAlpha: 0.85,
  controlledColor: 0x64748b, // slate-500
  formingColor: 0xf59e0b,    // status amber
  developedColor: 0xd06a42,  // Foundry copper
  pulsePeriodMs: 2000,
  pulseMaxRadius: 14,     // the soft ping's radius as it fades, world units
  /** Fraction of the period after which the ping's alpha starts falling (mock keyTimes 0;.55;1). */
  pulseFadeStart: 0.55,
} as const;

// ── System label backing (name) ──────────────────────────────────
// The name label sits below the glyph and can fall behind the nav ring /
// halo, so it gets a semi-transparent black backing for legibility.
export const LABEL = {
  bgFill:   0x000000,
  bgAlpha:  0.55,
  bgPadX:   4,
  bgPadY:   1.5,
  bgCorner: 3,
  offsetY:  38, // px below glyph centre, clear of the nav/selection ring
} as const;

// ── Animation ────────────────────────────────────────────────────

export const ANIM = {
  fitViewDuration:    400,   // ms
  setCenterDuration:  300,   // ms
  viewTransitionMs:   200,   // layer fade in/out
  twinkleMinPeriod:  3000,   // ms
  twinkleMaxPeriod:  8000,
  hoverScale:         1.05,
} as const;

// ── Flow overlay ─────────────────────────────────────────────────

/**
 * Directed-logistics overlay. Glowing "convoy" particles travel the lane itself (a straight segment
 * between its two endpoints) rather than an off-lane arc — a haul's route is now drawn as particles
 * on every lane it crosses, not a chord between its origin and destination, so there is no longer a
 * reason to bow the path off the lane it represents. Visual values are placeholders — tune in the
 * manual smoke (glow/speed).
 */
export const LOGISTICS_FLOW = {
  particleRadius: 3.4,
  particleSpeed: 95,
  particleAlpha: 0.95,
  /** Halo radius behind each particle (cheap glow). */
  glowBlur: 3,
  /** Faint static arc line under the particles. */
  pathAlpha: 0.18,
  /** Arrowhead size at the importing (destination) system. */
  arrowSize: 6,
  minParticlesPerEdge: 2,
  volumePerExtraParticle: 6,
  maxParticlesPerEdge: 10,
  /** Smaller global budget than market — logistics is sparse. */
  maxTotalParticles: 800,
} as const;

// ── Background ───────────────────────────────────────────────────

export const BG_COLOR = 0x030712; // gray-950

// ── Camera ───────────────────────────────────────────────────────

export const CAMERA = {
  minZoom: 0.15,
  maxZoom: 2.5,
  zoomStep: 0.001,   // per wheel delta pixel
  fitViewPadding: 0.15,
  panKeySpeed: 900,  // keyboard pan, screen px/s (zoom-invariant)
  panKeyBoost: 2,    // Shift multiplier
  clickDragThreshold: 5,  // px of pointer travel that turns a click into a drag
} as const;

// ── Starfield ────────────────────────────────────────────────────

export const STARFIELD = {
  layers: [
    { count: 200, parallax: 0.1, sizeMin: 0.5, sizeMax: 1.0, alphaMin: 0.15, alphaMax: 0.35 },
    { count: 150, parallax: 0.3, sizeMin: 0.8, sizeMax: 1.5, alphaMin: 0.25, alphaMax: 0.50 },
    { count: 100, parallax: 0.6, sizeMin: 1.0, sizeMax: 2.0, alphaMin: 0.35, alphaMax: 0.65 },
  ],
  fieldSize: 3000,   // star positions range in [-fieldSize, fieldSize]
} as const;

// ── Text rendering ───────────────────────────────────────────────

/** Render text at higher resolution so it stays crisp when zoomed in.
 *  Should be >= CAMERA.maxZoom so text stays sharp at max zoom. */
export const TEXT_RESOLUTION = 3;

// ── Label colors ─────────────────────────────────────────────────

export const TEXT_COLORS = {
  primary:   0xf1f5f9,  // slate-100
  secondary: 0x94a3b8,  // slate-400
  tertiary:  0x64748b,  // slate-500
  gateway:   0xf59e0b,  // amber-500
} as const;
