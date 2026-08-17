"use client";

import { memo } from "react";
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
  /** Whether the Tracker's settings panel is open — lifted to `star-map.tsx`, the same pattern as
   *  `mode`/`overlays` above: `AlertRun` (`components/alerts/alert-run.tsx`) needs this too, for its
   *  own right inset, which widens by the settings panel's width while it's open. A single source of
   *  truth in the parent is what lets both siblings read it without either reaching into the other's
   *  internals or the parent syncing two independent `useState`s via an effect. */
  settingsOpen: boolean;
  /** The header button's own click handler — same toggle it always drove, now owned one level up. */
  onToggleSettings: () => void;
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
 * guarantees. `settingsOpen`/`onToggleSettings` are lifted to `star-map.tsx` rather than owned here
 * (see `MapRightRailProps`) — plain `useState` there, not persisted: it's ephemeral UI state (which
 * panel is open right now), unlike section visibility, which is a standing preference the player
 * expects to hold across sessions — see `useTrackerSections`'s own docstring for why THAT one is
 * `localStorage`-backed.
 *
 * `pointer-events-none` on this column, `pointer-events-auto` on each real panel: the column spans
 * the full map height (`inset-y-2`) so empty space above/below/around the panels — including the
 * thin `gap-2` seams — passes clicks through to the map behind it instead of swallowing them.
 * `inset-y-2 right-2` (8px) is also the alert run's own inset (`components/alerts/alert-run.tsx`)
 * off the top of the map and off this same rail, so the two read as one consistent edge — the run's
 * right inset additionally tracks this column's own occupied width via the same lifted
 * `settingsOpen`.
 *
 * Rendered from `star-map.tsx`, right after the Pixi canvas and the debug overlay.
 *
 * Wrapped in `React.memo`: `StarMap` re-renders this on every throttled pan/zoom tick
 * (`THROTTLE_MS` in `lib/hooks/use-static-tiles.ts`), and without the memo boundary that drags the
 * whole Tracker subtree — one stateful `RichCard` per row — along for a viewport change that never
 * touches this component's own props. All six props are stable across those re-renders (`setMode`,
 * `toggle` and `onToggleSettings` are `useCallback`s with empty deps in `star-map.tsx`; `overlays`,
 * `mode` and `settingsOpen` are plain state), so the memo boundary holds.
 */
export const MapRightRail = memo(function MapRightRail({
  mode,
  setMode,
  overlays,
  toggle,
  settingsOpen,
  onToggleSettings,
}: MapRightRailProps) {
  const { sections, setSection } = useTrackerSections();

  return (
    <div className="pointer-events-none absolute inset-y-2 right-2 z-20 flex flex-col items-end gap-2">
      <div className="flex min-h-0 flex-1 gap-2">
        {settingsOpen && <TrackerSettings sections={sections} onChangeSection={setSection} />}
        <TrackerPanel sections={sections} settingsOpen={settingsOpen} onToggleSettings={onToggleSettings} />
      </div>
      <MapControlsDock mode={mode} setMode={setMode} overlays={overlays} toggle={toggle} />
    </div>
  );
});
