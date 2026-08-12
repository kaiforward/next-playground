"use client";

import type { MapMode } from "@/lib/types/map";
import type { MapOverlayKey, MapOverlays } from "@/lib/hooks/use-map-overlays";
import { TrackerPanel } from "@/components/tracker/tracker-panel";
import { MapControlsDock } from "@/components/map/map-controls-dock";

interface MapRightRailProps {
  mode: MapMode;
  setMode: (mode: MapMode) => void;
  overlays: MapOverlays;
  toggle: (key: MapOverlayKey) => void;
}

/**
 * The map's right-edge column — the ONE container the Tracker panel and the map controls dock
 * actually share (real siblings, not two independently-positioned overlays that merely avoid each
 * other), so they divide the vertical space between them by flex layout rather than a guessed
 * clearance: the Tracker takes `flex-1 min-h-0` (whatever room the dock doesn't need, scrolling
 * internally past that point — see `TrackerPanelContent`'s own `overflow-y-auto`), the dock stays
 * `shrink-0` at its natural height. Because the split is a real flex layout, it holds regardless of
 * how tall either panel's content gets.
 *
 * `pointer-events-none` on this column, `pointer-events-auto` on each child: the column spans the
 * full map height (`inset-y-4`) so empty space above/below the two panels — and the thin `gap-2`
 * between them — passes clicks through to the map behind it instead of swallowing them.
 *
 * Rendered from `star-map.tsx`, right after the Pixi canvas and the debug overlay.
 */
export function MapRightRail({ mode, setMode, overlays, toggle }: MapRightRailProps) {
  return (
    <div className="pointer-events-none absolute inset-y-4 right-4 z-20 flex flex-col items-end gap-2">
      <TrackerPanel />
      <MapControlsDock mode={mode} setMode={setMode} overlays={overlays} toggle={toggle} />
    </div>
  );
}
