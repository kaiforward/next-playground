"use client";

import type { MapMode } from "@/lib/types/map";
import type { MapOverlayKey, MapOverlays } from "@/lib/hooks/use-map-overlays";
import { MapOverlayControls } from "@/components/map/map-overlay-controls";

interface MapControlsDockProps {
  mode: MapMode;
  setMode: (mode: MapMode) => void;
  overlays: MapOverlays;
  toggle: (key: MapOverlayKey) => void;
}

/**
 * Anchors the map's floating control panels at the bottom-right. Right-
 * anchored so the dock clears the left-docked system-detail drawer. Add
 * future side/context panels as further children above the main panel — the
 * flex column manages the layout.
 */
export function MapControlsDock({
  mode,
  setMode,
  overlays,
  toggle,
}: MapControlsDockProps) {
  return (
    <div className="absolute bottom-4 right-4 z-20 flex flex-col items-end gap-2">
      <MapOverlayControls
        mode={mode}
        setMode={setMode}
        overlays={overlays}
        toggle={toggle}
      />
    </div>
  );
}
