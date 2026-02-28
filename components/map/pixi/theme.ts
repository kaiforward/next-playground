import type { EconomyType } from "@/lib/types/game";

// ── Economy colors (WebGL hex) ───────────────────────────────────

export const ECONOMY_COLORS: Record<EconomyType, { core: number; glow: number }> = {
  agricultural: { core: 0x86efac, glow: 0x22c55e },  // green-300 / green-500
  extraction:   { core: 0xfcd34d, glow: 0xf59e0b },  // amber-300 / amber-500
  refinery:     { core: 0x67e8f9, glow: 0x06b6d4 },  // cyan-300 / cyan-500
  industrial:   { core: 0xcbd5e1, glow: 0x94a3b8 },  // slate-300 / slate-400
  tech:         { core: 0x93c5fd, glow: 0x3b82f6 },  // blue-300 / blue-500
  core:         { core: 0xd8b4fe, glow: 0xa855f7 },  // purple-300 / purple-500
};

// ── Navigation state colors ──────────────────────────────────────

export const NAV_COLORS = {
  origin:      0x22d3ee,  // cyan-400
  reachable:   0xffffff,
  unreachable: 0x94a3b8,  // slate-400 (grayed)
  route_hop:   0x38bdf8,  // sky-400
  destination: 0x34d399,  // emerald-400
} as const;

// ── Edge colors ──────────────────────────────────────────────────

export const EDGE = {
  default:  { color: 0x94a3b8, alpha: 0.4,  width: 1.5 },
  dimmed:   { color: 0x94a3b8, alpha: 0.12, width: 1.0 },
  route:    { color: 0x63b3ed, alpha: 0.9,  width: 2.5 },
  region:   { color: 0x94a3b8, alpha: 0.5,  width: 3.0 },
} as const;

// ── Event dot colors ─────────────────────────────────────────────

export const EVENT_DOT_COLORS: Record<string, number> = {
  red:    0xef4444,
  amber:  0xf59e0b,
  purple: 0xa855f7,
  green:  0x22c55e,
  blue:   0x3b82f6,
  slate:  0x94a3b8,
};

// ── Sizes ────────────────────────────────────────────────────────

export const SIZES = {
  systemCoreRadius:   12,
  systemGlowRadius:   40,
  systemHitRadius:    20,
  systemLabelSize:    11,
  systemEconLabelSize: 9,
  systemShipLabelSize: 9,
  regionWidth:       180,
  regionHeight:      100,
  regionCornerRadius: 12,
  regionLabelSize:    14,
  regionSubLabelSize: 10,
  gatewayDotRadius:    5,
  eventDotRadius:      4,
  fuelLabelSize:      10,
  dashLength:          6,
  dashGap:             4,
} as const;

// ── Animation ────────────────────────────────────────────────────

export const ANIM = {
  fitViewDuration:    400,   // ms
  setCenterDuration:  300,   // ms
  viewTransitionMs:   200,   // layer fade in/out
  pulseRingPeriod:   2000,   // ms per cycle
  pulseRingMaxRadius: 30,
  particleSpeed:     100,    // pixels per second
  particlesPerEdge:    5,
  twinkleMinPeriod:  3000,   // ms
  twinkleMaxPeriod:  8000,
  hoverScale:         1.05,
} as const;

// ── Background ───────────────────────────────────────────────────

export const BG_COLOR = 0x030712; // gray-950

// ── Camera ───────────────────────────────────────────────────────

export const CAMERA = {
  minZoom: 0.3,
  maxZoom: 2.0,
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
 *  Value matches CAMERA.maxZoom — text is sharp up to max zoom level. */
export const TEXT_RESOLUTION = 2;

// ── Label colors ─────────────────────────────────────────────────

export const TEXT_COLORS = {
  primary:   0xf1f5f9,  // slate-100
  secondary: 0x94a3b8,  // slate-400
  tertiary:  0x64748b,  // slate-500
  ship:      0xfde047,  // yellow-300
  gateway:   0xf59e0b,  // amber-500
} as const;
