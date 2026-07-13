/**
 * Zoom-based level-of-detail thresholds.
 * Computed once per frame, passed to layers for visibility control.
 * Uses smooth transitions (lerp over a zoom range) to avoid hard cuts.
 */

/** Which rendering tier is active based on zoom level */
export type ViewTier = "universe" | "crossfade" | "system";

export interface LODState {
  /** Current rendering tier */
  viewTier: ViewTier;
  /** Point cloud alpha: 1 in universe, fades out 0.3→0.4, 0 in system */
  pointCloudAlpha: number;
  /** System layer alpha: 0 in universe, fades in 0.3→0.4, 1 in system */
  systemLayerAlpha: number;
  /** Whether SystemObject creation and frustum updates are enabled */
  systemObjectsActive: boolean;

  showSystemDots: boolean;
  showSystemNames: boolean;
  showTerritories: boolean;
  showRegionLabels: boolean;
  /** Scale factor for system dots at low zoom */
  systemDotScale: number;
  /** Alpha for system name labels (smooth fade) */
  systemNameAlpha: number;
  /** Alpha for the shared territory/choropleth layers (regions, stability, population, development). */
  territoryAlpha: number;
  /** Alpha for the Political (faction) territory layer. */
  politicalTerritoryAlpha: number;
  /** Alpha for region name labels */
  regionLabelAlpha: number;
  /** Whether to show glow effects */
  showGlow: boolean;
  /** Alpha for the directed-logistics overlay layer (smooth fade in 0.4 → 0.6). */
  logisticsAlpha: number;
  /** Whether pill TEXT/ICON content shows (shapes show earlier, with the layer). */
  showPillContent: boolean;
  /** Alpha for pill text/icon content (smooth fade). */
  pillContentAlpha: number;
}

/** Cubic smoothstep: 0 at edge0, 1 at edge1 with smooth acceleration/deceleration */
function smoothStep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Per-layer fade config. Each map mode / overlay that fades with zoom owns its
 * own settings so the team can tune them independently — bump the floor up if
 * a tint feels too faint at deep zoom, shift the curve later to keep the
 * universe view cleaner, etc.
 */
export interface FadeConfig {
  /** Zoom level where the fade starts (alpha = max below this). */
  start: number;
  /** Zoom level where the fade completes (alpha = min above this). */
  end: number;
  /** Floor alpha at and beyond `end`. */
  min: number;
  /** Ceiling alpha at and below `start`. Defaults to 1.0. */
  max?: number;
}

/**
 * Tweak these to retune the map. Each key is one fading layer. The territory
 * configs intentionally start with the same shape so the political layer and
 * the shared choropleth layers (regions, stability, population, development)
 * read the same visually until product decides otherwise.
 */
const LAYER_FADE = {
  /** Faction tint: full strength when zoomed out, half strength up close. */
  politicalTerritory: { start: 0.3, end: 0.7, min: 0.5 },
  /** Shared choropleth alpha (regions/stability/population/development): same shape as political for visual parity. */
  regionsTerritory: { start: 0.3, end: 0.7, min: 0.5 },
  /** Region name labels: fade out before deep zoom — text clutters systems. */
  regionLabels: { start: 0.3, end: 0.5, min: 0 },
} as const satisfies Record<string, FadeConfig>;

/** Lerps from `max` (at/below start) to `min` (at/beyond end), smoothstep eased. */
function computeFade(zoom: number, config: FadeConfig): number {
  const max = config.max ?? 1;
  return max - (max - config.min) * smoothStep(config.start, config.end, zoom);
}

export function computeLOD(zoom: number): LODState {
  // View tier: universe < 0.3, crossfade 0.3–0.4, system > 0.4
  const viewTier: ViewTier =
    zoom < 0.3 ? "universe" : zoom > 0.4 ? "system" : "crossfade";

  // Crossfade alphas
  const pointCloudAlpha = 1 - smoothStep(0.3, 0.4, zoom);
  const systemLayerAlpha = smoothStep(0.3, 0.4, zoom);

  // Enable SystemObject creation before crossfade begins so objects are ready
  const systemObjectsActive = zoom >= 0.28;

  return {
    viewTier,
    pointCloudAlpha,
    systemLayerAlpha,
    systemObjectsActive,

    // System dots always visible
    showSystemDots: true,

    // All system text shares one late band: it begins fading in at 0.8 and is
    // fully in by 0.9. Earlier than this the labels render too small to read
    // and just add clutter — keep the mid-zoom view to glyphs + pill shapes.
    showSystemNames: zoom > 0.8,
    systemNameAlpha: smoothStep(0.8, 0.9, zoom),

    // Territories never cull — they're the spatial frame for every
    // territory/choropleth mode (political, regions, stability, population,
    // development). Political reads its own alpha; the other four share
    // `territoryAlpha` so they can diverge from political but stay in sync
    // with each other.
    showTerritories: true,
    territoryAlpha: computeFade(zoom, LAYER_FADE.regionsTerritory),
    politicalTerritoryAlpha: computeFade(zoom, LAYER_FADE.politicalTerritory),

    // Region labels fade out by deep zoom — text clutters individual systems.
    showRegionLabels: zoom < 0.5,
    regionLabelAlpha: computeFade(zoom, LAYER_FADE.regionLabels),

    // Scale dots down at low zoom (min 0.35, max 1.0)
    systemDotScale: Math.max(0.35, Math.min(1.0, smoothStep(0.15, 0.5, zoom))),

    // Glow effects only at medium+ zoom
    showGlow: zoom > 0.45,

    // Trade-flow overlay fades in across the crossfade-to-system band
    logisticsAlpha: smoothStep(0.4, 0.6, zoom),

    // Pill content (text/icon) reveals with system names on the 0.8–0.9 text
    // band — the pill shapes still appear far earlier (with systemLayerAlpha),
    // so far-out pills read as bare colour until the labels come in.
    showPillContent: zoom > 0.8,
    pillContentAlpha: smoothStep(0.8, 0.9, zoom),
  };
}
