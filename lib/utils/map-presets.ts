import type { MapOverlays } from "@/lib/hooks/use-map-overlays";

/**
 * A map preset is a named bundle of overlay toggles. Picking a preset flips the
 * overlays to a curated set; toggling any overlay by hand drops to `custom`.
 * Presets are pure data — the hook (`use-map-overlays`) owns the live state and
 * the panel (`map-overlay-controls`) renders the chips. Keeping the mapping here
 * means it can be unit-tested without a DOM.
 */
export type MapPreset = "default" | "trader" | "navigator" | "custom";

const SETS: Record<Exclude<MapPreset, "custom">, MapOverlays> = {
  // New player landing view: see your fleet + what's happening.
  default: { fleet: true, events: true, priceHeatmap: false, tradeFlow: false, shipRoutes: false },
  // Trading lens: where's it cheap/expensive, plus events that move prices.
  trader: { fleet: false, events: true, priceHeatmap: true, tradeFlow: false, shipRoutes: false },
  // Logistics lens: your fleet + every in-transit route.
  navigator: { fleet: true, events: false, priceHeatmap: false, tradeFlow: false, shipRoutes: true },
};

/** Panel order — `custom` is last and only surfaces when no preset matches. */
export const PRESETS: readonly MapPreset[] = ["default", "trader", "navigator", "custom"];

/** The overlay set for a concrete (non-custom) preset. Returns a fresh object. */
export function overlaysForPreset(p: Exclude<MapPreset, "custom">): MapOverlays {
  return { ...SETS[p] };
}

/** The preset matching a given overlay set, or `custom` when none match. */
export function presetForOverlays(o: MapOverlays): MapPreset {
  for (const key of ["default", "trader", "navigator"] as const) {
    const s = SETS[key];
    if (
      s.fleet === o.fleet &&
      s.events === o.events &&
      s.priceHeatmap === o.priceHeatmap &&
      s.tradeFlow === o.tradeFlow &&
      s.shipRoutes === o.shipRoutes
    ) {
      return key;
    }
  }
  return "custom";
}
