"use client";

import { useState } from "react";
import type { MapMode } from "@/lib/types/map";
import type { MapOverlayKey, MapOverlays } from "@/lib/hooks/use-map-overlays";
import { useTrackerSections } from "@/lib/hooks/use-tracker-sections";
import { TrackerPanel } from "@/components/tracker/tracker-panel";
import { TrackerSettings } from "@/components/tracker/tracker-settings";
import { MapControlsDock } from "@/components/map/map-controls-dock";

interface MapRightRailProps {
  mode: MapMode;
  setMode: (mode: MapMode) => void;
  overlays: MapOverlays;
  toggle: (key: MapOverlayKey) => void;
}

/**
 * The map's right-edge column — the ONE container the Tracker (plus its settings panel) and the
 * map controls dock actually share (real siblings, not independently-positioned overlays that
 * merely avoid each other), so they divide the vertical space between them by flex layout rather
 * than a guessed clearance: the upper row takes `flex-1 min-h-0` (whatever room the dock doesn't
 * need, scrolling internally past that point — see `TrackerPanelContent`'s own `overflow-y-auto`),
 * the dock stays `shrink-0` at its natural height. Because the split is a real flex layout, it
 * holds regardless of how tall any of the panels' content gets.
 *
 * The upper row is itself a horizontal flex pair — `TrackerSettings` (when open) to the LEFT of
 * `TrackerPanel`, per the owner decision that the settings surface is a sibling panel, never a
 * popover or dropdown. `TrackerSettings` is mounted conditionally on `settingsOpen`: absent
 * entirely when closed, so it claims no space in the row. The default (no explicit
 * `items-*` on the row) is flex's `stretch`, which is what lets both panels share the row's full
 * height as visual siblings — `items-end` stays on the OUTER column only, right-anchoring the
 * row-plus-dock stack against the map edge.
 *
 * `useTrackerSections()` is called ONCE here, not inside `TrackerPanel` or `TrackerSettings`
 * separately — both need the SAME live state (a checkbox toggled in Settings must immediately
 * filter Tracker's own render), which only one shared hook instance, passed down as props,
 * guarantees. `settingsOpen` is plain `useState`, not persisted: it's ephemeral UI state (which
 * panel is open right now), unlike section visibility, which is a standing preference the player
 * expects to hold across sessions — see `useTrackerSections`'s own docstring for why THAT one is
 * `localStorage`-backed.
 *
 * `pointer-events-none` on this column, `pointer-events-auto` on each real panel: the column spans
 * the full map height (`inset-y-4`) so empty space above/below/around the panels — including the
 * thin `gap-2` seams — passes clicks through to the map behind it instead of swallowing them.
 *
 * Rendered from `star-map.tsx`, right after the Pixi canvas and the debug overlay.
 */
export function MapRightRail({ mode, setMode, overlays, toggle }: MapRightRailProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { sections, setSection } = useTrackerSections();

  return (
    <div className="pointer-events-none absolute inset-y-4 right-4 z-20 flex flex-col items-end gap-2">
      <div className="flex min-h-0 flex-1 gap-2">
        {settingsOpen && <TrackerSettings sections={sections} onChangeSection={setSection} />}
        <TrackerPanel
          sections={sections}
          settingsOpen={settingsOpen}
          onToggleSettings={() => setSettingsOpen((open) => !open)}
        />
      </div>
      <MapControlsDock mode={mode} setMode={setMode} overlays={overlays} toggle={toggle} />
    </div>
  );
}
