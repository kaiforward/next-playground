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
}

/**
 * Anchors the map's floating control panels at the bottom-left and stacks them
 * upward. The main panel sits at the bottom (fixed position); context panels
 * (currently just Price, shown when its overlay is on) stack above it, so
 * toggling one never reflows the main panel. Add future side/context panels as
 * further children — the flex column manages the layout.
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
}: MapControlsDockProps) {
  return (
    <div className="absolute bottom-4 left-4 z-20 flex flex-col items-start gap-2">
      {overlays.priceHeatmap && (
        <MapPricePanel
          priceGoodId={priceGoodId}
          setPriceGoodId={setPriceGoodId}
          goods={goods}
          onOpenComparisonTable={onOpenComparisonTable}
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
