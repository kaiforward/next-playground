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
  /** Whether SystemObjects should exist (hysteresis buffer at 0.28) */
  systemObjectsActive: boolean;

  showSystemDots: boolean;
  showSystemNames: boolean;
  showEconomyLabels: boolean;
  showShipLabels: boolean;
  showEventDots: boolean;
  showFuelLabels: boolean;
  showTerritories: boolean;
  showRegionLabels: boolean;
  /** Scale factor for system dots at low zoom */
  systemDotScale: number;
  /** Alpha for system name labels (smooth fade) */
  systemNameAlpha: number;
  /** Alpha for economy/ship/fuel labels */
  detailAlpha: number;
  /** Alpha for territory fills and outlines */
  territoryAlpha: number;
  /** Alpha for region name labels */
  regionLabelAlpha: number;
  /** Alpha for event dots */
  eventDotAlpha: number;
  /** Whether to show glow effects */
  showGlow: boolean;
  /** Whether to show effect layer (particles, pulse rings) */
  showEffects: boolean;
}

/** Cubic smoothstep: 0 at edge0, 1 at edge1 with smooth acceleration/deceleration */
function smoothStep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function computeLOD(zoom: number): LODState {
  // View tier: universe < 0.3, crossfade 0.3–0.4, system > 0.4
  const viewTier: ViewTier =
    zoom < 0.3 ? "universe" : zoom > 0.4 ? "system" : "crossfade";

  // Crossfade alphas
  const pointCloudAlpha = 1 - smoothStep(0.3, 0.4, zoom);
  const systemLayerAlpha = smoothStep(0.3, 0.4, zoom);

  // Start creating SystemObjects slightly before crossfade begins (hysteresis)
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

    // Economy/ship/fuel labels fade in 0.6–0.7
    showEconomyLabels: zoom > 0.6,
    showShipLabels: zoom > 0.6,
    showFuelLabels: zoom > 0.6,
    detailAlpha: smoothStep(0.6, 0.7, zoom),

    // Event dots fade in 0.5–0.6 (after names settle)
    showEventDots: zoom > 0.5,
    eventDotAlpha: smoothStep(0.5, 0.6, zoom),

    // Territories visible in universe/crossfade, fade out in system view
    showTerritories: zoom < 0.5,
    territoryAlpha: 1 - smoothStep(0.3, 0.5, zoom),

    // Region labels visible in universe view, fade at same range as territories
    showRegionLabels: zoom < 0.5,
    regionLabelAlpha: 1 - smoothStep(0.3, 0.5, zoom),

    // Scale dots down at low zoom (min 0.35, max 1.0)
    systemDotScale: Math.max(0.35, Math.min(1.0, smoothStep(0.15, 0.5, zoom))),

    // Glow effects only at medium+ zoom
    showGlow: zoom > 0.45,

    // Effects (particles, pulse rings) visible alongside names
    showEffects: zoom > 0.45,
  };
}
