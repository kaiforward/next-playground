/**
 * Zoom-based level-of-detail thresholds.
 * Computed once per frame, passed to layers for visibility control.
 * Uses smooth transitions (lerp over a zoom range) to avoid hard cuts.
 */

export interface LODState {
  showSystemDots: boolean;
  showSystemNames: boolean;
  showEconomyLabels: boolean;
  showShipLabels: boolean;
  showEventDots: boolean;
  showFuelLabels: boolean;
  showRegionBoundaries: boolean;
  showRegionLabels: boolean;
  /** Scale factor for system dots at low zoom */
  systemDotScale: number;
  /** Alpha for system name labels (smooth fade) */
  systemNameAlpha: number;
  /** Alpha for economy/ship/fuel labels */
  detailAlpha: number;
  /** Alpha for region boundary lines */
  regionBoundaryAlpha: number;
  /** Alpha for region name labels */
  regionLabelAlpha: number;
  /** Alpha for event dots */
  eventDotAlpha: number;
  /** Whether to show glow effects */
  showGlow: boolean;
  /** Whether to show effect layer (particles, pulse rings) */
  showEffects: boolean;
}

/** Smooth lerp: 0 at edge0, 1 at edge1 */
function smoothStep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t;
}

export function computeLOD(zoom: number): LODState {
  return {
    // System dots always visible
    showSystemDots: true,

    // System names fade in 0.35–0.45
    showSystemNames: zoom > 0.35,
    systemNameAlpha: smoothStep(0.35, 0.45, zoom),

    // Economy/ship/fuel labels fade in 0.6–0.7
    showEconomyLabels: zoom > 0.6,
    showShipLabels: zoom > 0.6,
    showFuelLabels: zoom > 0.6,
    detailAlpha: smoothStep(0.6, 0.7, zoom),

    // Event dots fade in 0.4–0.5
    showEventDots: zoom > 0.4,
    eventDotAlpha: smoothStep(0.4, 0.5, zoom),

    // Region boundaries fade out 1.0–1.5
    showRegionBoundaries: zoom < 1.5,
    regionBoundaryAlpha: 1 - smoothStep(1.0, 1.5, zoom),

    // Region labels fade out 0.7–1.0
    showRegionLabels: zoom < 1.0,
    regionLabelAlpha: 1 - smoothStep(0.7, 1.0, zoom),

    // Scale dots down at low zoom (min 0.35, max 1.0)
    systemDotScale: Math.max(0.35, Math.min(1.0, smoothStep(0.15, 0.5, zoom))),

    // Glow effects only at medium+ zoom
    showGlow: zoom > 0.45,

    // Effects (particles, pulse rings) only when zoomed in enough to see
    showEffects: zoom > 0.6,
  };
}
