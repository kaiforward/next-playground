"use client";

import type { MapMode } from "@/lib/types/map";
import { MapOverlayControls } from "@/components/map/map-overlay-controls";

interface MapControlsDockProps {
  mode: MapMode;
  setMode: (mode: MapMode) => void;
}

/**
 * The map's floating control panels, right-anchored so the dock clears the left-docked
 * system-detail drawer. Add future side/context panels as further children above the main panel —
 * the flex column manages the layout.
 *
 * Rendered from `components/map/map-right-rail.tsx` as the bottom child of the right-edge column
 * it shares with `TrackerPanel` (top child, sibling in the same flex column — see the note there):
 * `shrink-0` here is what keeps this dock at its natural height while the Tracker is the one that
 * gives up space when the column runs short.
 */
export function MapControlsDock({
  mode,
  setMode,
}: MapControlsDockProps) {
  return (
    <div className="pointer-events-auto flex shrink-0 flex-col items-end gap-2">
      <MapOverlayControls
        mode={mode}
        setMode={setMode}
      />
    </div>
  );
}
