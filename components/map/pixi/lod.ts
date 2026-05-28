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
  showEconomyLabels: boolean;
  showFuelLabels: boolean;
  showTerritories: boolean;
  showRegionLabels: boolean;
  /** Scale factor for system dots at low zoom */
  systemDotScale: number;
  /** Alpha for system name labels (smooth fade) */
  systemNameAlpha: number;
  /** Alpha for economy/ship/fuel labels */
  detailAlpha: number;
  /** Alpha for the Regions (economy) territory layer. */
  territoryAlpha: number;
  /** Alpha for the Political (faction) territory layer. */
  politicalTerritoryAlpha: number;
  /** Alpha for region name labels */
  regionLabelAlpha: number;
  /** Whether to show glow effects */
  showGlow: boolean;
  /** Whether to show effect layer (particles, pulse rings) */
  showEffects: boolean;
  /** Whether to show fleet presence dots */
  showFleetDots: boolean;
  /** Alpha for fleet presence dots */
  fleetDotAlpha: number;
  /** Alpha for trade-flow particles (smooth fade in 0.4 → 0.6). */
  tradeFlowAlpha: number;
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
 * configs intentionally start with the same shape so political and regions
 * mode read the same visually until product decides otherwise.
 */
const LAYER_FADE = {
  /** Faction tint: full strength when zoomed out, half strength up close. */
  politicalTerritory: { start: 0.3, end: 0.7, min: 0.5 },
  /** Region (economy) tint: same shape as political for visual parity. */
  regionsTerritory: { start: 0.3, end: 0.7, min: 0.5 },
  /** Region name labels: fade out before deep zoom — text clutters systems. */
  regionLabels: { start: 0.3, end: 0.5, min: 0 },
  /** Fleet presence dots: fade out with the region labels. */
  fleetDots: { start: 0.3, end: 0.5, min: 0 },
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

    // System names fade in 0.45–0.55 (after crossfade completes at 0.4)
    showSystemNames: zoom > 0.45,
    systemNameAlpha: smoothStep(0.45, 0.55, zoom),

    // Economy/fuel labels fade in 0.6–0.7
    showEconomyLabels: zoom > 0.6,
    showFuelLabels: zoom > 0.6,
    detailAlpha: smoothStep(0.6, 0.7, zoom),

    // Territories never cull — they're the spatial frame for both modes.
    // Each layer reads its own alpha so political and regions can diverge.
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

    // Effects (particles, pulse rings) visible alongside names
    showEffects: zoom > 0.45,

    // Fleet dots visible at low zoom, fade with the region-label band
    showFleetDots: zoom < 0.5,
    fleetDotAlpha: computeFade(zoom, LAYER_FADE.fleetDots),

    // Trade-flow overlay fades in across the crossfade-to-system band
    tradeFlowAlpha: smoothStep(0.4, 0.6, zoom),
  };
}
