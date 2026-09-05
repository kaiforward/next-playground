"use client";

import { useMemo } from "react";
import { useNavigate } from "@/components/ui/link-provider";
import { useAtlas } from "@/lib/hooks/use-atlas";
import { laneEndpoints } from "@/lib/engine/lanes";
import { laneHref } from "@/lib/utils/route-hrefs";
import type { SystemTabSegment } from "@/lib/constants/system-tabs";

/**
 * The `loc` cache-buster's counter, module-level rather than one per hook instance. There is exactly
 * ONE consumer of the value — the `focus|loc` key `star-map.tsx` recentres off — but many hook
 * instances writing it: the Tracker's, plus one per visible alert chip. Per-instance counters all
 * start at 0, so two of them locating the same system emit a byte-identical `?focus=x,y&loc=1`, the
 * key never changes, and the second locate opens the panel without ever flying the camera. A counter
 * shared by every call site is what makes "differs from the last value written" true of the URL
 * itself rather than of one caller's private history. Nothing renders off it, so it is deliberately
 * not React state.
 */
let locSeq = 0;

/**
 * The next `loc` value for a focus URL. Exported so a panel building its own focus URL (the system
 * panel's and the lane card's "Show on Map") advances the SAME counter the focus hooks do — two
 * schemes on one URL is how a locate silently does nothing: on a collision the map's fly-to effect,
 * keyed on `focus|loc`, never sees the key change and never re-fires.
 */
export function nextLocSeq(): number {
  locSeq += 1;
  return locSeq;
}

/** The atlas's system coordinates, keyed by id — memoised once per atlas and shared by both focus
 *  hooks below rather than derived twice. */
function useSystemCoords(): ReadonlyMap<string, { x: number; y: number }> {
  const { atlas } = useAtlas();
  return useMemo(
    () => new Map(atlas.systems.map((s) => [s.id, { x: s.x, y: s.y }] as const)),
    [atlas.systems],
  );
}

/**
 * Fly-to-system-and-open-tab navigation — extracted from `TrackerPanel`'s own `activate`
 * (`components/tracker/tracker-panel.tsx`) the moment a second consumer needed it
 * (`components/alerts/alert-flyout.tsx`'s row activation), per AGENTS.md's extract-on-second-
 * occurrence rule. Builds `/system/<id>[/<segment>]?focus=<x>,<y>&loc=<n>` from the atlas's own
 * coordinates plus a monotonic `loc` cache-buster: `loc` has to differ from the value the URL last
 * carried so the map's focus effect (keyed on `focus|loc`, see `star-map.tsx`) re-fires even when
 * locating the same system twice in a row.
 *
 * `segment` is typed on the full `SystemTabSegment` union (all six system-panel tabs), wider than
 * the `"" | "industry"` either caller alone ever needed — the Tracker only ever passes `""` or
 * `"industry"`, the alert flyout adds `"population"`/`"logistics"`, and typing this on the real tab
 * union rather than a hand-listed subset is what stops a future caller's tab going stale here.
 *
 * Every caller shares one counter — see `locSeq` above. The nonce lands in a single URL read by a
 * single consumer, so it is that URL's history the value has to differ from, not any one caller's.
 *
 * A stale or unknown system id (shouldn't happen — every reader filters to live systems) is a
 * silent no-op rather than a broken push to a coordinate-less route.
 */
export function useSystemFocus() {
  const navigate = useNavigate();
  const coordsById = useSystemCoords();

  return function focusSystem(systemId: string, segment: SystemTabSegment) {
    const coords = coordsById.get(systemId);
    if (!coords) return; // stale id (shouldn't happen — the service filters abandoned pins/instances)
    const path = segment ? `/system/${systemId}/${segment}` : `/system/${systemId}`;
    navigate(`${path}?focus=${coords.x},${coords.y}&loc=${nextLocSeq()}`);
  };
}

/**
 * Fly-to-lane navigation — the lane's two endpoints' midpoint on the same `?focus=<x>,<y>&loc=<n>`
 * channel `star-map.tsx` reads. Two callers, one implementation: the Lane congested alert's row
 * activation (`components/alerts/alert-run.tsx`'s `ActiveAlertFlyout`) opens the lane's card at the
 * midpoint, and the lane card's own "Show on Map" button (`components/panels/lane-panel.tsx`) passes
 * `replace: true` to recentre the map without pushing a history entry or leaving the card it is
 * already on. Shares `locSeq` with `useSystemFocus` above (see that counter's own docstring) rather
 * than keeping a second one — there is exactly one URL for every caller to disagree about.
 *
 * A stale or malformed lane key (shouldn't happen — every reader filters to live lanes) is a silent
 * no-op, the same posture `focusSystem` takes for a stale system id.
 */
export function useLaneFocus(options: { replace?: boolean } = {}) {
  const navigate = useNavigate();
  const coordsById = useSystemCoords();
  const replace = options.replace ?? false;

  return function focusLane(laneKey: string) {
    let aId: string, bId: string;
    try {
      [aId, bId] = laneEndpoints(laneKey);
    } catch {
      return; // malformed key — shouldn't happen, see this function's own docstring
    }
    const a = coordsById.get(aId);
    const b = coordsById.get(bId);
    if (!a || !b) return; // stale endpoint (shouldn't happen — the service filters abandoned lanes)
    const x = (a.x + b.x) / 2;
    const y = (a.y + b.y) / 2;
    // The destination is always the lane's own route — which, for the card's own button, is the
    // route it is already on; `replace` is what keeps that self-navigation out of the history stack.
    navigate(`${laneHref(laneKey)}?focus=${x},${y}&loc=${nextLocSeq()}`, { replace });
  };
}
