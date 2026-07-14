"use client";

import type { MapMode } from "@/lib/types/map";
import type { MapOverlayKey, MapOverlays } from "@/lib/hooks/use-map-overlays";
import { MapOverlayControls } from "@/components/map/map-overlay-controls";
import { MapPricePanel } from "@/components/map/map-price-panel";

interface MapControlsDockProps {
  mode: MapMode;
  setMode: (mode: MapMode) => void;
  overlays: MapOverlays;
  toggle: (key: MapOverlayKey) => void;
  priceGoodId: string | null;
  setPriceGoodId: (goodId: string | null) => void;
  goods: { id: string; name: string }[];
  onOpenComparisonTable: () => void;
  priceMode: "buy" | "sell";
  setPriceMode: (mode: "buy" | "sell") => void;
}

/**
 * Anchors the map's floating control panels at the bottom-right and stacks
 * them upward. The main panel sits at the bottom (fixed position); context
 * panels (currently just Price, shown when its overlay is on) stack above it,
 * so toggling one never reflows the main panel. Add future side/context
 * panels as further children — the flex column manages the layout. Right-
 * anchored so the dock clears the left-docked system-detail drawer.
 */
export function MapControlsDock({
  mode,
  setMode,
  overlays,
  toggle,
  priceGoodId,
  setPriceGoodId,
  goods,
  onOpenComparisonTable,
  priceMode,
  setPriceMode,
}: MapControlsDockProps) {
  return (
    <div className="absolute bottom-4 right-4 z-20 flex flex-col items-end gap-2">
      {overlays.priceHeatmap && (
        <MapPricePanel
          priceGoodId={priceGoodId}
          setPriceGoodId={setPriceGoodId}
          goods={goods}
          onOpenComparisonTable={onOpenComparisonTable}
          priceMode={priceMode}
          setPriceMode={setPriceMode}
        />
      )}
      <MapOverlayControls
        mode={mode}
        setMode={setMode}
        overlays={overlays}
        toggle={toggle}
      />
    </div>
  );
}
