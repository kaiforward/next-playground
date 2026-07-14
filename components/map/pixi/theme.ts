import type { SystemEventInfo } from "@/lib/hooks/use-map-data";
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

// ── Edge colors ──────────────────────────────────────────────────

export const EDGE = {
  default:  { color: 0x94a3b8, alpha: 0.4,  width: 1.5 },
  // Gateway trunk routes — amber "lit pathway": a wide soft glow under a crisp
  // core line. Amber matches TEXT_COLORS.gateway so gateway edges and labels
  // share one identity (replaces the old per-system fuchsia gateway ring).
  gateway:     { color: 0xf59e0b, alpha: 0.85, width: 2.5 },
  gatewayGlow: { color: 0xf59e0b, alpha: 0.15, width: 7.0 },
} as const;

// ── Event dot colors ─────────────────────────────────────────────

export const EVENT_DOT_COLORS: Record<SystemEventInfo["color"], number> = {
  red:    0xef4444,
  amber:  0xf59e0b,
  purple: 0xa855f7,
  green:  0x22c55e,
  blue:   0x3b82f6,
  slate:  0x94a3b8,
};

// Event icon by colour bucket (SystemEventInfo.color already categorises).
export const EVENT_ICON: Record<SystemEventInfo["color"], string> = {
  red:    "⚔",   // conflict / raid
  amber:  "▲",   // boom / shock
  purple: "✦",   // anomaly / precursor
  green:  "★",   // festival / boon
  blue:   "⚛",   // tech
  slate:  "●",   // generic
};

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
  eventDotRadius:      4,
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

// ── Unified corner-pill geometry (all four corners share this) ───
export const PILL = {
  height:    18,
  corner:    5,
  padX:      5,
  gap:       3,   // gap between a pill's icon and its count text
  offset:    4,   // radial gap between pill edge and core
} as const;

// ── Corner-pill anchors (top-right price, bottom-right event) ───
// Each pill's inner corner (the one nearest the core) sits on the 45° diagonal,
// just outside the halo — so pills read as orbiting the glyph rather than
// crowding the core. The vertical anchor is the horizontal one plus half a pill
// height, because pills are vertically centred on their anchor.
const PILL_CORNER_RADIUS = 22;                          // just outside the star bloom (GLYPH.bloomRadius 20)
const PILL_CORNER_XY = PILL_CORNER_RADIUS / Math.SQRT2; // ≈ 15.6 per axis
export const PILL_ANCHOR = {
  x:       PILL_CORNER_XY,                        // inner vertical edge of L/R pills
  yTop:    -(PILL_CORNER_XY + PILL.height / 2),   // top pills (anchor centre)
  yBottom: PILL_CORNER_XY + PILL.height / 2,      // bottom pills (anchor centre)
} as const;

// ── System label backing (name) ──────────────────────────────────
// The name label sits below the glyph and can fall behind the nav ring /
// halo, so it gets a semi-transparent black backing for legibility. It's
// pushed far enough down to clear the bottom corner-pills: the event pill
// (and the mirror space a bottom-left pill would use) reaches
// `yBottom + height/2` below centre, so the name's top starts a few px past
// that.
const BOTTOM_PILL_REACH = PILL_ANCHOR.yBottom + PILL.height / 2; // ≈ 34
export const LABEL = {
  bgFill:   0x000000,
  bgAlpha:  0.55,
  bgPadX:   4,
  bgPadY:   1.5,
  bgCorner: 3,
  offsetY:  BOTTOM_PILL_REACH + 4, // ≈ 38 — name top clears the bottom pills
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
 * Directed-logistics overlay. Arced, glowing "convoy" particles. Visual values
 * are placeholders — tune in the manual smoke (bow/glow/speed).
 */
export const LOGISTICS_FLOW = {
  /** Perpendicular bow as a fraction of chord length. */
  arcBowFraction: 0.18,
  /** Max bow in world units (clamps long hauls so they don't balloon). */
  arcMaxBow: 600,
  /** Polyline segments per arc. */
  arcSegments: 24,
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
